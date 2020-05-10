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
  if (!(globalTablesV2 && globalTablesV2.tables)) {
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

        if (!uow.config.addRegions.includes(options.region)) {
          log.info(`Using Resource refs for global table ${uow.config.table} arn's for ${options.region}`);
        } else {
          log.info(`Retrieving global table ${uow.config.table} arn's for ${options.region}...`);
          await serverless.getProvider('aws').request('DynamoDB', 'describeTable', {
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
            })
            .catch(e => {
              log.error(e.message);
              log.info(`Defaulting ${uow.config.table} to local resources`);
              return Promise.resolve(uow);
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