const args = require('minimist')(process.argv.slice(2));

const RedisMQ = require('rsmq');
const redis = require('redis').createClient(process.env.REDIS_URL);
const redisQueue = new RedisMQ({client: redis, ns: 'rsmq'});

// Perform a webhook update.
const processBatch = require('./worker');
const getForksForRepo = require('./helpers').getForksForRepo;

const createPullRequest = require('./helpers').createPullRequest;
const didRepoOptOut = require('./helpers').didRepoOptOut;
const checkRateLimit = require('./helpers').checkRateLimit;

const githubPullRequestsCreate = github => github.pullRequests.create

const ONE_HOUR_IN_SECONDS = 60 * 60;
const debug = require('debug')('backstroke:webhook-status-store');
const WebhookStatusStore = {
  set(webhookId, status, expiresIn=24*ONE_HOUR_IN_SECONDS) {
    return new Promise((resolve, reject) => {
      redis.set(`webhook:status:${webhookId}`, JSON.stringify(status), 'EX', expiresIn, (err, id) => {
        if (err) {
          reject(err);
        } else {
          // Resolves the message id.
          resolve(id);

          // Notate how the operation went
          if (status.status === 'OK') {
            // Finally, increment the success / error metrics
            debug(`Incrementing webhook:stats:successes key...`);
            redis.incr(`webhook:stats:successes`, err => {
              if (err) {
                debug(`Error incrementing webhook webhook:stats:successes key: ${err}`);
              }
            });
          } else if (status.status === 'ERROR') {
            // Finally, increment the error metric
            debug(`Incrementing webhook:stats:errors key...`);
            redis.incr(`webhook:stats:errors`, err => {
              if (err) {
                debug(`Error incrementing webhook webhook:stats:errors key: ${err}`);
              }
            });
          }
        }
      });
    });
  },
  get(webhookId) {
    return new Promise((resolve, reject) => {
      redis.get(`webhook:status:${webhookId}`, (err, data) => {
        if (err) {
          reject(err);
        } else {
          // Resolves the cached data.
          resolve(JSON.parse(data));
        }
      });
    });
  },
};

const WebhookQueue = {
  queueName: process.env.REDIS_QUEUE_NAME || 'webhookQueue',
  initialize() {
    return new Promise((resolve, reject) => {
      redisQueue.createQueue({qname: this.queueName}, (err, resp) => {
        if (err && err.name === 'queueExists') {
          // Queue was already created.
          resolve();
        } else if (err) {
          reject(err);
        } else {
          resolve(resp);
        }
      });
    });
  },
  push(data) {
    return new Promise((resolve, reject) => {
      redisQueue.sendMessage({qname: this.queueName, message: JSON.stringify(data)}, (err, id) => {
        if (err) {
          reject(err);
        } else {
          // Resolves the message id.
          resolve(id);
        }
      });
    });
  },
  pop() {
    return new Promise((resolve, reject) => {
      redisQueue.popMessage({qname: this.queueName}, (err, data) => {
        if (err) {
          reject(err);
        } else if (!data || typeof data.id === 'undefined') {
          // No items in the queue
          resolve(null);
        } else {
          // Item was found on the end of the queue!
          resolve({data: JSON.parse(data.message), id: data.id});
        }
      });
    });
  },
};
WebhookQueue.initialize();


// Logging function to use in webhooks.
function logger() {
  console.log.apply(console, ['   *', ...arguments]);
}


if (require.main === module) {
  let rawPullRequestCreate = githubPullRequestsCreate;
  if (process.env.PR === 'mock' || args.pr === 'mock') {
    console.log('* Using pull request mock...');
    rawPullRequestCreate = () => async (...args) =>
      console.log('  *', require('chalk').green('MOCK CREATE PR'), args);
  }

  // Provide a mechanism to throttle the time between handling webhooks
  const throttleBatch = process.env.THROTTLE ? parseInt(process.env.THROTTLE, 10) : 0;

  // Called once the process finishes.
  function final() {
    redis.quit();
  }

  // Kick off the batch!
  function go(done) {
    processBatch(
      WebhookQueue,
      WebhookStatusStore,
      logger,
      getForksForRepo,
      createPullRequest,
      didRepoOptOut,
      rawPullRequestCreate,
      throttleBatch,
      checkRateLimit
    ).then(() => {
      console.log('* Success!');
      done();
    }).catch(err => {
      console.error('Error:');
      console.error(err.stack ? err.stack : err);
      done();
    });
  }

  if (args.once) {
    go(final);
  } else {
    setInterval(go.bind(null, a => a), process.env.WORKER_POLL_INTERVAL || 5000);
  }
}
