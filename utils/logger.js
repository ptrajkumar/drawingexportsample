const log4js = require('log4js');
log4js.configure({
  appenders: {
    everything: { type: 'stdout' },
    main: { type: 'file', filename: 'main.log', maxLogSize: 1048576, backups: 3 },
    infofilter: { type: 'logLevelFilter', appender: 'everything', level: 'info' }
  },
  categories: { default: { appenders: ['main', 'infofilter'], level: 'all' } }
});

module.exports = log4js;
