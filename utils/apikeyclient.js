const unirest = require('unirest');
const crypto = require('crypto');
const randomstring = require('randomstring');
const log = require('./logger').getLogger('api');
const fs = require('fs');

function ApiKeyClient(baseURL, accessKey, secretKey) {
  if (!baseURL) {
    throw new Error('baseURL cannot be empty');
  }

  if (!accessKey) {
    throw new Error('accessKey cannot be empty');
  }

  if (!secretKey) {
    throw new Error('secretKey cannot be empty');
  }

  this.baseURL = baseURL;
  this.accessKey = accessKey;
  this.secretKey = secretKey;
  this.userId = '';
  this.companyId = '';
}

ApiKeyClient.prototype.callApiPost = function (apiRelativePath, bodyData) {
  return this.callApiVerb(apiRelativePath, 'POST', bodyData);
};

ApiKeyClient.prototype.callApiGet = function (apiRelativePath) {
  return this.callApiVerb(apiRelativePath, 'GET');
};

ApiKeyClient.prototype.callApiDelete = function (apiRelativePath) {
  return this.callApiVerb(apiRelativePath, 'DELETE');
};

ApiKeyClient.prototype.downloadFile = function (documentId, externalId, filePath) {
  var self = this;
  return new Promise(function (resolve, reject) {
    log.debug(`downloadFile for ${documentId} to ${filePath}`);
    const downloadreq = self.getSignedUnirest(self.baseURL + 'api/documents/d/' + documentId + '/externaldata/' + externalId, 'GET');
    downloadreq
      .encoding('binary')
      .timeout(600000)
      .end(function (response) {
        if (response.statusCode !== 200) {
          reject('Failed with status code ' + response.statusCode);
        } else {
          fs.writeFileSync(filePath, response.raw_body, 'binary');
          resolve();
        }
      });
  });
};

ApiKeyClient.prototype.callApiVerb = function (apiRelativePath, verb, bodyData) {
  var self = this;
  const fullUri = apiRelativePath.startsWith('http') ? apiRelativePath : this.baseURL + apiRelativePath;
  log.debug(`Calling ${verb} ${fullUri}`);
  return new Promise(function (resolve, reject) {
    const lunitest = self.getSignedUnirest(fullUri, verb);
    if (bodyData) {
      lunitest.type('json')
        .header('Accept', 'application/json')
        .send(bodyData)
        .timeout(600000);
    }

    lunitest.end(function (response) {
      if (response.statusCode !== 200 || response.error) {
        const errorJson = {
          statusCode: response.statusCode || 'UNKNOWN_STATUS_CODE',
          error: response.error || 'NO_ERROR',
          errorBody: response.body || 'NO_BODY'
        };
        log.error(`${apiRelativePath} failed`, errorJson);
        reject(errorJson);
      } else {
        resolve(response.body);
      }
    });
  });
};

ApiKeyClient.prototype.getSignedUnirest = function (fullUri, method, contentType) {
  const authDate = (new Date()).toUTCString();
  const onNonce = randomstring.generate({
    length: 25,
    charset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890'
  });

  const parsedUrl = new URL(fullUri);
  let queryString = parsedUrl.searchParams.toString();
  if (queryString){
    parsedUrl.search = '';
    fullUri  = parsedUrl.toString() + '?' + queryString;
  }

  contentType = contentType || 'application/json';

  const hmacString = [
    method,
    onNonce,
    authDate,
    contentType,
    parsedUrl.pathname,
    queryString,
    ''
  ].join('\n').toLowerCase();

  const hmac = crypto.createHmac('sha256', this.secretKey);
  hmac.update(hmacString);
  const signature = hmac.digest('base64');
  const asign = 'On ' + this.accessKey + ':HmacSHA256:' + signature;

  var lunitest = null;
  if ('GET' === method) {
    lunitest = unirest.get(fullUri);
  } else if ('POST' === method) {
    lunitest = unirest.post(fullUri);
  } else if ('PATCH' === method) {
    lunitest = unirest.patch(fullUri);
  } else if ('HEAD' === method) {
    lunitest = unirest.head(fullUri);
  } else if ('PUT' === method) {
    lunitest = unirest.put(fullUri);
  } else if ('DELETE' === method) {
    lunitest = unirest.delete(fullUri);
  }
  lunitest.header('content-type', contentType);
  lunitest.header('On-Nonce', onNonce);
  lunitest.header('Date', authDate);
  lunitest.header('Authorization', asign);
  lunitest.header('Accept', 'application/vnd.onshape.v1+json,application/json');
  return lunitest;
};

module.exports = ApiKeyClient;
