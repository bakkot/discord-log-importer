# discord log-importer

A barebones library to facilitate importing old messages and logs to a Discord server.

## Setup

`npm i` to install dependencies.

You'll need to [create an app](https://discordjs.guide/preparations/setting-up-a-bot-application.html) and its bot user, then [add it to your server](https://discordjs.guide/preparations/adding-your-bot-to-servers.html) with the "bot" scope and the "Administrator" bot permission. (Only a subset of the bot permissions are required but I haven't bothered narrowing it down.)

Save the token for your bot somewhere.

## Use

This is intended as a scaffold for importing logs in whatever format you have them in. You'll need to write code to handle conversion from your log format.

`src/log-importer.ts` exports a function `init` which takes the bot token, a guild ID, and a filename to save state in (to make it easier to resume if interrupted).

That function returns some functions which are useful for adding logs.

- `addUser` creates a (virtual) user. It takes a `tag` used to identify it internally, plus a name and optional avatar (which can be a path to a file on disk or a URL)
- `hasUser` checks if a given internal user tag exists
- `findChannelNamed` and `findOrCreateChannelNamed` do what they say and return a channel ID (or null, if you pass a non-existent name to `findChannelNamed`)
- `post` takes a channel ID, a user tag, a message, and an optional array of files (which should be paths to files on disk). Keep in mind the global 8 MB per message limit for files (may be higher on boosted servers).

It also returns `client`. You should call `client.destroy()` when finished (or just kill it manually).

The `post` function includes a 3-second delay to prevent you from running into rate limits.

## Example

This code assumes that you have a folder `/logs` with subdirectories `#channel-one`, `#channel-2`, etc, each of which contains `2000-12-31.json` log files which are in the format `{ "name": "user-1", "message": "whatever", "files": ["/path-to-file.txt"] }`.

Rather than massaging your logs into that format, you should use the code below as a starting point to write code which works with whatever format your logs are in.

This code also assumes all messages are from either "user-1" or "user-2". If you don't have a list of usernames-with-avatars up front, you can also call `addUser` whenever you encounter a new username in your logs.

It will create channels as necessary and post a timestamp message at the start of each day of the logs, in addition to the messages from users. If the server already has a channel whose name matches a channel from the log, it will use that one.

```js
import * as path from 'path';
import * as fs from 'fs';
import { init } from './log-importer';

const { token } = require('../config.json') as { token: string };
const GUILD_ID = '1000000000000000000';
const STATE_FILE = path.join(__dirname, '../state.json');

const LOG_ROOT = '/logs';

(async () => {
  let { client, guild, addUser, hasUser, findOrCreateChannelNamed, post } = await init(token, GUILD_ID, STATE_FILE);

  if (!hasUser('user-1')) {
    await addUser('user-1', 'Username', path.join(__dirname, '../icon-user-1.jpg'));
  }
  if (!hasUser('user-2')) {
    await addUser('user-2', 'Username-Two', path.join(__dirname, '../icon-user-2.jpg'));
  }
  if (!hasUser('timestamp')) {
    await addUser('timestamp', '-', path.join(__dirname, '../icon-clock.jpg'));
  }

  for (let channel of fs.readdirSync(LOG_ROOT, { withFileTypes: true })) {
    if (!channel.isDirectory() || !channel.name.startsWith('#')) continue;
    let channelName = channel.name.slice(1);
    console.log('## channel ' + channelName);

    let channelId = await findOrCreateChannelNamed(channelName);
    for (let file of fs.readdirSync(path.join(LOG_ROOT, channel.name), { withFileTypes: true })) {
      let m = file.name.match(/^(?<year>[0-9]{4})-(?<month>[0-9]{1,2})-(?<day>[0-9]{1,2})\.json$/);
      if (m == null) continue;
      let { year, month, day } = m.groups!;
      let formatted = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      console.log(formatted);
      await post(channelId, 'timestamp', formatted);

      let messages = JSON.parse(fs.readFileSync(path.join(LOG_ROOT, channel.name, file.name), 'utf8').split('\n'));
      for (let { name, message, files } of messages) {
        if (message.trim() === '') continue;
        let totalSize = files.reduce((acc, f) => acc + fs.statSync(f).size, 0);
        if (totalSize > 7.5 * 2 ** 20) {
          // discord limit is 8mb; stay under 7.5 to be conservative
          console.log(`too large: ${channel.name} ${year}-${month}-${day} ${m2[0]}`);
          message += ' [logbot could not upload files]';
          files = [];
        }
        if (limessagene.length > 1975) {
          for (let i = 0; i < message.length; i += 1950) {
            // discord has a maximum message length of 2000 chars
            let part = message.slice(i, i + 1950);
            if (i > 0) {
              part = '... ' + part;
            }
            if (i + 1950 < message.length) {
              part += '...';
            }
            await post(channelId, name, part, files);
          }
        } else {
          await post(channelId, name, message, files);
        }
      }
    }
  }
  client.destroy();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
```
