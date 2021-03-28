const ApiKeyClient = require('./utils/apikeyclient');
const log = require('./utils/logger').getLogger('export');
const fs = require('fs');
const mkdirp = require('mkdirp');
const timeSpan = require('time-span');

const argv = require('minimist')(process.argv.slice(2));
const stackToUse = argv['stack'] || 'reardmener';

const ElementType = {
  PARTSTUDIO: 0,
  ASSEMBLY: 1,
  DRAWING: 2
};

// Where all drawing exports should go
const EXPORT_FOLDER = argv['export-dir'] || `./pdfoutput/${stackToUse}`;
// This file contains stateful information as to what was the last rev that was succesfully exported so we can resume
const LAST_EXPORT_INFO_FILE = EXPORT_FOLDER + '/lastexport.json';

/**
 * Pause the running script
 * @param {*} millis Number of milliseconds to sleep for
 */
function sleep(millis) {
  return new Promise(resolve => setTimeout(resolve, millis));
}

/**
 * Read what is the last processed revision date
 */
function readExportedInfoInformation() {
  let exportedInfo = {
    date: '2000-01-01T00:00:00Z'
  };

  if (fs.existsSync(LAST_EXPORT_INFO_FILE)) {
    exportedInfo = JSON.parse(fs.readFileSync(LAST_EXPORT_INFO_FILE));
  }

  exportedInfo.offset = exportedInfo.offset || 0;
  if (exportedInfo.revCreatedDate) {
    exportedInfo.offset = 0;
    exportedInfo.date = exportedInfo.revCreatedDate;
  }

  exportedInfo.badrevisions = exportedInfo.badrevisions || {};
  return exportedInfo;
}

/**
 * Save to the file what is the last rev that has been successfully exported
 */
function saveExportedInfoInformation(nextBatchUri, lastRev, exportedInfo) {
  if (nextBatchUri) {
    const myURL = new URL(nextBatchUri);
    exportedInfo.date = myURL.searchParams.get('after') || exportedInfo.date;
    exportedInfo.offset = myURL.searchParams.get('offset') || 0;
  }
  if (lastRev) {
    exportedInfo.partNumber = lastRev.partNumber;
    exportedInfo.revision = lastRev.revision;
    if (lastRev.createdAt) {
      exportedInfo.date = lastRev.createdAt;
      exportedInfo.offset = 0;
    }
  }
  fs.writeFileSync(LAST_EXPORT_INFO_FILE, JSON.stringify(exportedInfo, null, 2));
}

/**
 * Mark a revision as bad during export so it is not attempted again.
 */
function markRevisionAsBad(rev, exportedInfo, failureMessage) {
  exportedInfo.badrevisions[rev.id] = {
    documentId: rev.documentId,
    versionId: rev.versionId,
    elementId: rev.elementId,
    partNumber: rev.partNumber,
    revision: rev.revision,
    failure: failureMessage
  };
  log.warn(`Encountered bad revision error=${failureMessage}`, exportedInfo.badrevisions[rev.id]);
}


/**
 * Exports all unprocessed drawing revisions
 */
async function exportAllReleasedDrawings(apiClient) {
  const companyId = apiClient.companyId;

  let exportedInfo = readExportedInfoInformation();

  // This will get us all revisions created since after date
  let nextBatchUri = `api/revisions/companies/${companyId}?offset=${exportedInfo.offset}&after=${new Date(exportedInfo.date).toISOString()}`;
  let batchCount = 0;
  while (nextBatchUri) {
    log.info(`Processed revisions count= ${batchCount}`);
    const revisionsResponse = await apiClient.callApiGet(nextBatchUri);
    const revCount = revisionsResponse.items ? revisionsResponse.items.length : 0;
    batchCount += revCount;
    if (revCount === 0) {
      log.info(`No more revisions exist since ${exportedInfo.date}`);
      return;
    }

    const lastRev = await processRevisionBatch(revisionsResponse.items, apiClient, exportedInfo);
    nextBatchUri = revisionsResponse.next;
    saveExportedInfoInformation(nextBatchUri, lastRev, exportedInfo);
  }
}

/**
 * Process a single batch of revisions.
 */
async function processRevisionBatch(revisions, apiClient, exportedInfo) {
  let exportedInfoRev = null;
  for (const rev of revisions) {
    log.debug(`Processing revision partnum=${rev.partNumber} revision=${rev.revision} elementType=${rev.elementType}`);

    if (exportedInfo.badrevisions[rev.id]) {
      log.warn(`Ignoring previously errored out export partnum=${rev.partNumber} rev=${rev.revision} documentId=${rev.documentId}`);
      exportedInfoRev = rev;
      continue;
    }

    // This is just for illustration the company revisions api support filtering drawing elements
    if (rev.elementType != ElementType.DRAWING) {
      log.debug(`Ignoring non drawing partnum=${rev.partNumber}`);
      exportedInfoRev = rev;
      continue;
    }

    const documentId = rev.documentId;
    let docResponse = null;
    try {
      docResponse = await apiClient.callApiGet(`api/documents/${documentId}`);
    } catch (err) {
      log.error(`Failed to find documentId=${documentId}`, err);
    }

    if (!docResponse || docResponse.trash) {
      markRevisionAsBad(rev, exportedInfo, 'Failed to find document');
      exportedInfoRev = rev;
      continue;
    }

    await exportSingleDrawing(rev, apiClient, exportedInfo);
    exportedInfoRev = rev;
  }
  return exportedInfoRev;
}

/**
 * Export a revision corresponding to a drawing.
 */
async function exportSingleDrawing(rev, apiClient, exportedInfo) {
  const documentId = rev.documentId;
  const outputFileName = `${rev.partNumber}_${rev.revision}.pdf`;
  const pdfOutput = EXPORT_FOLDER + '/' + outputFileName;

  if (fs.existsSync(pdfOutput)) {
    log.info(`${pdfOutput} has already been exported`);
    return;
  }

  // Initiate a request to translate a drawing. This gives href that you can poll to see if the translation has completed
  const translationReq = await apiClient.callApiPost(`api/drawings/d/${documentId}/v/${rev.versionId}/e/${rev.elementId}/translations`, {
    formatName: 'PDF',
    storeInDocument: false,
    showOverriddenDimensions: true,
    destinationName: outputFileName
  });

  log.info(`Created translation request for ${outputFileName}`);
  let jobStatus = { requestState: 'ACTIVE' };

  // Wait until the drawing export has finished
  const end = timeSpan();
  while (jobStatus.requestState === 'ACTIVE') {
    await sleep(5000);
    const elaspedSeconds = end.seconds();

    // If export takes over 10 minutes log and continue
    if (elaspedSeconds > 600) {
      markRevisionAsBad(rev, exportedInfo, `Timed out after ${elaspedSeconds} seconds`);
      return;
    }

    log.debug(`Waited for translation ${outputFileName} seconds=${elaspedSeconds} for ${outputFileName}`);
    jobStatus = await apiClient.callApiGet(translationReq.href);
  }

  if (jobStatus.requestState !== 'DONE') {
    markRevisionAsBad(rev, exportedInfo, `Export never attained DONE state final state=${jobStatus.requestState}`);
    return;
  }

  // The pdf will be saved as an externalId against the original document
  const externalId = jobStatus.resultExternalDataIds[0];
  if (!externalId) {
    throw new Error('Bad translate done response');
  }

  // Download the export result and store it locally
  await apiClient.downloadFile(`api/documents/d/${documentId}/externaldata/${externalId}`, pdfOutput);
}

/**
 * Create an api client that can call apis against an enterprise. Use
 * https://dev-portal.onshape.com/keys to create a api key against an company
 * and add it to credentials.json. Change default value away from reardmener
 */
async function createApiClient() {
  const credentialsFilePath = './credentials.json';
  if (!fs.existsSync(credentialsFilePath)) {
    throw new Error(`${credentialsFilePath} not found`);
  }

  // Change this to a key in credentials.json after creating api keys
  log.info(`Creating api client against stack=${stackToUse}`);
  const credentials = JSON.parse(fs.readFileSync(credentialsFilePath));
  const credsToUse = credentials[stackToUse];
  if (!credsToUse) {
    throw new Error(`No credentials for stack=${stackToUse} in ${credentialsFilePath}`);
  }

  const apiClient = new ApiKeyClient(credsToUse.url, credsToUse.accessKey, credsToUse.secretKey);
  apiClient.companyId = credsToUse.companyId;
  return apiClient;
}

/**
 * This is the main entry point
 */
void async function () {
  try {
    // Ensure export folder exists
    mkdirp.sync(EXPORT_FOLDER);

    const apiClient = await createApiClient();

    await exportAllReleasedDrawings(apiClient);
  } catch (error) {
    console.error(error);
    log.error('Export failed', error);
  }
}();