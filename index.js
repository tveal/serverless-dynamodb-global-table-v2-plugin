const { replaceTableRefs } = require('./lib/substitutions');
const { createAutoscalingArtifacts } = require('./lib/autoscaling');
const { deploy } = require('./lib/deploy');

class Plugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:package:setupProviderConfiguration': replaceTableRefs.bind(this),
      'before:deploy:createDeploymentArtifacts': createAutoscalingArtifacts.bind(this),
      'after:deploy:deploy': deploy.bind(this),
    };
  }

  log = {
    info: (msg) => {
      this.serverless.cli.log(`[global-table-plugin] INFO ${msg}`);
    },
    error: (msg) => {
      this.serverless.cli.log(`[global-table-plugin] ERROR ${msg}`);
    },
    warn: (msg) => {
      this.serverless.cli.log(`[global-table-plugin] WARN ${msg}`);
    },
  }
}

module.exports = Plugin;
