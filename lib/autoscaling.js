'use strict';
const _ = require('lodash');

module.exports = {
  createAutoscalingArtifacts,
};

function createAutoscalingArtifacts() {
  const { serverless, options, log } = this;
  const globalTablesV2 = serverless.service.custom.globalTablesV2;

  if (!(globalTablesV2 && globalTablesV2.primaryRegion && globalTablesV2.autoscale)) {
    log.warn('Skipping autoscale provisioning. Not configured.');
    return Promise.resolve();
  }

  const { Resources } = serverless.service.resources;

  return Promise.resolve().then(() => {
    // for each table config, set tableName if NOT in primaryRegion
    const tables = globalTablesV2.tables.map(config => {
      config.tableName = options.region !== globalTablesV2.primaryRegion
        ? Resources[config.table].Properties.TableName
        : false;
      return config;
    });

    log.info('Autoscale: setting up scaling role');
    _.merge(
      serverless.service.provider.compiledCloudFormationTemplate.Resources,
      scalingRole(tables)
    );

    tables.forEach(
      (config) => {
        let resources = [];

        if (config.read) {
          log.info(`Autoscale: setting up READ Scalable Target and Policy for ${config.table}`);
          resources.push(scalableTarget(config, 'Read'));
          resources.push(scalingPolicy(config, 'Read'));
        }

        if (config.write) {
          log.info(`Autoscale: setting up WRITE Scalable Target and Policy for ${config.table}`);
          resources.push(scalableTarget(config, 'Write'));
          resources.push(scalingPolicy(config, 'Write'));
        }

        resources.forEach(
          (resource) => _.merge(
            serverless.service.provider.compiledCloudFormationTemplate.Resources,
            resource
          )
        );
      }
    );
  }).catch(err => {
    log.error(err.message);
    throw err;
  });
};

const scalableTarget = (config, dimension) => {
  const { table, tableName } = config;
  const capacity = config[dimension.toLocaleLowerCase()];

  const DependsOn = ['ScalingRole'];
  let ResourceId;

  if (!tableName) {
    DependsOn.push(table);
    ResourceId = {
      'Fn::Join': [
        '',
        [
          'table/',
          {
            'Ref': table
          }
        ]
      ]
    };
  } else {
    ResourceId = `table/${tableName}`;
  }

  return {
    [`${table}AutoScalableTarget${dimension}`]: {
      Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
      DependsOn,
      Properties: {
        MinCapacity: capacity.minimum,
        MaxCapacity: capacity.maximum,
        ScheduledActions: (capacity.actions || []).map(action => ({
          ScalableTargetAction: {
            MinCapacity: action.minimum,
            MaxCapacity: action.maximum,
          },
          ScheduledActionName: action.name,
          Schedule: action.schedule
        })),
        ResourceId,
        RoleARN: {
          'Fn::GetAtt': [
            'ScalingRole',
            'Arn'
          ]
        },
        ScalableDimension: `dynamodb:table:${dimension}CapacityUnits`,
        ServiceNamespace: 'dynamodb'
      },
    },
  };
};

const scalingPolicy = (config, dimension) => {
  const { table, tableName } = config;
  const capacity = config[dimension.toLocaleLowerCase()];

  const DependsOn = [`${table}AutoScalableTarget${dimension}`];
  if (!tableName) DependsOn.push(table);

  return {
    [`${table}AutoScalingPolicy${dimension}`]: {
      Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
      DependsOn,
      Properties: {
        PolicyName: `${table}AutoScalingPolicy${dimension}`,
        PolicyType: 'TargetTrackingScaling',
        ScalingTargetId: {
          Ref: `${table}AutoScalableTarget${dimension}`,
        },
        TargetTrackingScalingPolicyConfiguration: {
          PredefinedMetricSpecification: {
            PredefinedMetricType: `DynamoDB${dimension}CapacityUtilization`
          },
          ScaleInCooldown: 60,
          ScaleOutCooldown: 60,
          TargetValue: capacity.usage * 100
        }
      },
    },
  };
};

const scalingRole = (tables) => {
  const role = {
    ScalingRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'application-autoscaling.amazonaws.com'
              }
            }
          ],
        },
        Policies: [
          {
            PolicyName: 'ScalingRolePolicy',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Action: [
                    'cloudwatch:PutMetricAlarm',
                    'cloudwatch:DescribeAlarms',
                    'cloudwatch:DeleteAlarms',
                    'cloudwatch:GetMetricStatistics',
                    'cloudwatch:SetAlarmState'
                  ],
                  Effect: 'Allow',
                  Resource: '*'
                },
                {
                  Action: [
                    'dynamodb:DescribeTable',
                    'dynamodb:UpdateTable'
                  ],
                  Effect: 'Allow',
                  Resource: tables.map(config => {
                    let tableNameRef;
                    if (!config.tableName) {
                      tableNameRef = {
                        'Ref': config.table
                      };
                    } else {
                      tableNameRef = config.tableName;
                    }
                    return {
                      'Fn::Join': [
                        '',
                        [
                          'arn:aws:dynamodb:*:',
                          {
                            'Ref': 'AWS::AccountId'
                          },
                          ':table/',
                          tableNameRef
                        ]
                      ]
                    }
                  }),
                }
              ],
            },
          }
        ],
      },
    }
  };

  if (tables.filter(config => config.tableName).length === 0) {
    role.DependsOn = tables.map(config => config.table);
  }
  return role;
};
