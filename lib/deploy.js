module.exports = {
  deploy,
};

function deploy() {
  const {
    serverless,
    options,
    log,
  } = this;

  const globalTablesV2 = serverless.service.custom.globalTablesV2;

  if (!(globalTablesV2 && globalTablesV2.tables)) {
    log.warn('Skipping global-table-v2 deploy. Not configured.');
    return Promise.resolve();
  }

  const tap = _tap(log);
  const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;

  return Promise.all(
    globalTablesV2.tables.filter(config => config.addRegions)
      .map(config => ({
        tableName: Resources[config.table].Properties.TableName,
        regions: config.addRegions.filter(region => region !== options.region)
      }))
      .map(uow =>
        serverless.getProvider('aws').request('DynamoDB', 'describeTable', {
          TableName: uow.tableName
        })
          .then(data => ({ ...uow, ...data }))
          .then((uow) => {
            const { Replicas } = uow.Table;
            if (Replicas) {
              uow.regionsToAdd = getRegionsToAdd(Replicas.map(region => region.RegionName), uow.regions);
            } else {
              uow.regionsToAdd = uow.regions;
            }
            if (uow.regionsToAdd.length > 0) {
              const ReplicaUpdates = uow.regionsToAdd.map(region => ({
                Create: {
                  RegionName: region
                }
              }));
              return serverless.getProvider('aws').request('DynamoDB', 'updateTable', {
                TableName: uow.tableName,
                ReplicaUpdates,
              })
                .then(data => ({ ...uow, ...data }))
                .then(tap)
                .then((uow) => {
                  log.info(`Updated global table: ${uow.tableName} with region(s): ${uow.regionsToAdd}`);
                  return uow;
                });
            } else {
              return Promise.resolve(uow)
                .then(tap)
                .then((uow) => {
                  log.info(`Region(s): ${uow.regions} already in global table: ${uow.tableName}`);
                  return uow;
                });
            }
          })
          .catch((e) => {
            log.error(e.message);
            throw e;
          })
      )
  );
};

const getRegionsToAdd = (existingRegions, desiredRegions) => {
  return desiredRegions.filter(region => !existingRegions.includes(region));
};

const _tap = log => (globalTable) => {
  log.info(`globalTable: ${JSON.stringify(globalTable, null, 2)}`);
  return globalTable;
};
