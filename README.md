# Backstroke Worker

The Backstroke Worker eats off of a [rsmq](https://github.com/smrchy/rsmq) queue, performing a link
update. In order, here's roughly what happens:

- A new operation is pulled off the queue.
- The link's type is checked:
  - If the type is `repo`:
    - Check to make sure the fork didn't opt out of Backstroke pull requests.
      - If so, return an error.
    - Create a pull request to propose the new changes.
  - If the type is `fork-all`:
    - Get all forks of the upstream.
    - Loop through each:
      - Check to make sure the fork didn't opt out of Backstroke pull requests.
        - If so, return an error.
      - Create a pull request to propose the new changes.
- Add the response back into the Redis instance under the operation id, so it can be fetched by the
  main server.

## Usage
```
GITHUB_TOKEN=XXX REDIS_URL=redis://XXX yarn start
```

### Environment variables
- `GITHUB_TOKEN` (required): The Github token for the user that creates pull requests. When
  deployed, this is a token for [backstroke-bot](https://github.com/backstroke-bot).
- `REDIS_URL` (required): A url to a redis instance with a rsmq queue inside. Takes the form of
  `redis://user:password@host:port`.
- `THROTTLE`: Provide an optional delay between handling each webhook operation. This is
  potentially handy to keep a worker from exhausing the rate limit on a token.
- `GITHUB_BOT_USERNAME`: The username of the bot user that reates pull requests. Used to grant
  permissions to the bot user on private repositories.

## Arguments
- `--pr mock`: Tell the worker not to actually make pull requests, but only log out when it is about
  to make a pull request. This is handy for repeated testing or for testing against repositories
  that you don't own. This option is off by default.

## Running tests
  ```
yarn test
  ```
