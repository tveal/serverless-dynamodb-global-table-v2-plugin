const retryTotal = () => parseInt(process.env.GTV2_RETRY, 10) || 30;
const retryPauseMillis = () => parseInt(process.env.GTV2_RETRY_PAUSE_MILLIS, 10) || 10000;

module.exports = {
  replaceTableRefs,
};

function replaceTableRefs() {
  const {
    serverless,
    options,
    log,
  } = this;

  const { globalTablesV2 } = serverless.service.custom;
  if (!(globalTablesV2 && globalTablesV2.primaryRegion && globalTablesV2.tables)) {
    log.warn('Skipping global-table-v2 substitution. Not configured.');
    return Promise.resolve();
  }

  const { Resources } = serverless.service.resources;
  const replaceData = {};

  return Promise.all(
    globalTablesV2.tables.filter(config => config.addRegions)
      .map(config => ({ config }))
      .map(async uow => {
        // {
        //   table: 'MyTable1',
        //   addRegions: [ 'us-west-2' ]
        // }
        replaceData[uow.config.table] = {};

        if (globalTablesV2.primaryRegion === options.region) {
          log.info(`Using Resource refs for global table ${uow.config.table} arn's for ${options.region}`);
        } else {
          log.info(`Retrieving global table ${uow.config.table} arn's for ${options.region}...`);
          await retry(log)(() => serverless.getProvider('aws').request('DynamoDB', 'describeTable', {
            TableName: Resources[uow.config.table].Properties.TableName,
          })
            .then(data => ({ ...uow, ...data }))
            .then(uow => {
              const {
                TableArn,
                LatestStreamArn,
              } = uow.Table;

              log.info('Found TableArn=' + TableArn);
              replaceData[uow.config.table] = { TableArn, LatestStreamArn };
              return Promise.resolve(uow);
            }))
            .catch(e => {
              log.error(e.message);
              return Promise.reject(e);
            });
        }
      })
  ).then(uow => {
    substituteGlobalTableV2Refs(serverless, log, replaceData);
    return Promise.resolve(uow);
  });
};

const substituteGlobalTableV2Refs = (serverless, log, replaceData = {}) => {
  const serverlessThings = Object.keys(serverless.service).filter(key => key !== 'serverless');

  const sub = (search, replace) => {
    serverlessThings.map(key => {
      const valString = JSON.stringify(serverless.service[key]);
      if (valString && valString.includes(search)) {
        serverless.service[key] = JSON.parse(valString.split(search).join(replace));
        log.info(`Replacing ${search} with ${replace} in serverless.service.${key}`);
      }
    });
  };

  for (const table in replaceData) {
    const options = replaceData[table];

    const TableArn = options.TableArn || {
      "Fn::GetAtt": [
        table,
        "Arn"
      ]
    };
    const LatestStreamArn = options.LatestStreamArn || {
      "Fn::GetAtt": [
        table,
        "StreamArn"
      ]
    };

    const searchTableArn = `"sub${table}Arn"`;
    const searchTableStreamArn = `"sub${table}StreamArn"`;

    const replaceTableArn = typeof TableArn === 'string' ? `"${TableArn}"` : JSON.stringify(TableArn);
    const replaceTableStreamArn = typeof LatestStreamArn === 'string' ? `"${LatestStreamArn}"` : JSON.stringify(LatestStreamArn);

    sub(searchTableArn, replaceTableArn);
    sub(searchTableStreamArn, replaceTableStreamArn);
  }
};

const pause = duration => new Promise(res => setTimeout(res, duration));
const retry = log => (fn, options = {}) => {
  const { trace = {} } = options;
  let {
    retries = retryTotal(),
    attempt = 1,
  } = options;

  trace.attempts = attempt;
  trace.unusedRetries = retries;

  return fn().catch((err) => {
    if (retries > 0) {
      const pauseMillis = retryPauseMillis();
      log.info(`backoff attempt: ${attempt}; pause millis: ${pauseMillis}`);

      retries -= 1;
      attempt += 1;
      return pause(pauseMillis).then(() => retry(log)(fn, { retries, attempt, trace }));
    }
    log.error(`Failed to retry; Configured retries: ${retryTotal()}, Total attempts: ${attempt}`);
    return Promise.reject(err);
  }).then((uow) => {
    // log.info(`function call completed successfully: ${JSON.stringify(uow, null, 2)}`);
    return uow;
  });
};

