import * as fs from 'fs';
import * as path from 'path';
import { Client, GatewayIntentBits, DataResolver, TextChannel, Webhook, AttachmentBuilder, Guild } from 'discord.js';
import {ChannelType} from 'discord-api-types/v10';

type Importer = {
  client: Client,
  guild: Guild,
  addUser: (tag: string, name: string, avatarUrl?: string | null) => Promise<void>;
  hasUser: (tag: string) => boolean;
  findChannelNamed: (name: string) => string | undefined;
  findOrCreateChannelNamed: (name: string) => Promise<string>;
  post: (channelId: string, userTag: string, message: string, files?: string[]) => Promise<void>;
}

let sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// web hooks are limited to 30 requests / minute
// this is a per-hook limit but it's not worth trying to coordinate that
// 3000ms is therefore overkill but not hugely
export async function init(token: string, guildId: string, stateFile: string, pauseMs = 3000): Promise<Importer> {
  type State = {
    guildId: string;
    users: {
      // map of user specifiers to names/avatars
      [userId: string]: {
        name: string;
        avatar: string | null; // dataURI, i.e. discord image data: https://discord.com/developers/docs/reference#image-data
      };
    };
    channels: {
      // map of (channelId, user) -> webhook for that user in that channel
      [channelId: string]: {
        [userId: string]: string; // map of unique user specifiers to webhook
      };
    };
  };
  let state: State = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    : {
        guildId,
        users: {
          __proto__: null,
        },
        channels: {
          __proto__: null,
        },
      };
  if (state.guildId !== guildId) {
    throw new Error(
      'guildId from state.json does not match current guildId; if you want to start fresh, delete state.json',
    );
  }

  function saveState() {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  }

  async function addUser(tag: string, name: string, avatarUrl: string | null = null) {
    if (state.users[tag]) {
      throw new Error(`user ${tag} already configured`);
    }
    let avatar = avatarUrl == null ? null : await DataResolver.resolveImage(avatarUrl);
    if (avatarUrl != null && avatar == null) {
      throw new Error(`could not resolve avatar ${avatarUrl}`);
    }
    state.users[tag] = {
      name,
      avatar,
    };
    saveState();
  }

  return new Promise(res => {
    let client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once('ready', () => {
      // console.log('Ready!');
      let guild = client.guilds.cache.get(guildId)!;
      if (guild == null) {
        throw new Error(`could not find guild ${guildId}`);
      }
      // console.log([...guild.channels.cache]);
      function findChannelNamed(name: string): string | undefined {
        return guild.channels.cache.find(c => c.name === name)?.id;
      }

      async function findOrCreateChannelNamed(name: string): Promise<string> {
        if (!/^[a-zA-Z_-]+$/.test(name) || name.length === 0 || name.length > 100) {
          throw new Error(`${name} is not a valid channel name (I think)`);
        }
        let existing = findChannelNamed(name);
        if (existing != null) {
          return existing;
        }
        let c = await guild.channels.create({
          name,
        });
        return c.id;
      }

      let hookCache = new Map<string, Webhook>;

      function hasUser(tag: string) {
        return tag in state.users;
      }

      async function post(channelId: string, userTag: string, message: string, files: string[] = []) {
        // validation
        if (!state.users[userTag]) {
          throw new Error(`unknown user ${userTag}; add them with addUser first`);
        }
        let user = state.users[userTag];
        if (!guild.channels.cache.has(channelId)) {
          throw new Error(`unknown channel ${channelId}; did you pass an actual channel ID, as returned by findChannelNamed?`);
        }
        let channel = guild.channels.cache.get(channelId)!;
        if (channel.type !== ChannelType.GuildText) {
          throw new Error(`${channelId} is not a text channel (is instead ${ChannelType[channel.type]})`);
        }

        // set up webhook, if necessary
        if (!state.channels[channelId]) {
          state.channels[channelId] = {};
        }
        if (!state.channels[channelId][userTag]) {
          console.log(`creating webhook in channel ${channelId} for user ${userTag}`);
          let hook = await channel.createWebhook({
            name: user.name,
            avatar: user.avatar,
          });
          state.channels[channelId][userTag] = hook.id;
          saveState();
          hookCache.set(hook.id, hook);
        }
        let hookId = state.channels[channelId][userTag];
        if (!hookCache.has(hookId)) {
          hookCache.set(hookId, await client.fetchWebhook(hookId));
        }

        // actually send message
        let hook = hookCache.get(hookId)!;
        await hook.send({
          content: message,
          files,
        });
        await sleep(pauseMs);
      }

      res({
        client,
        guild,
        addUser,
        hasUser,
        findChannelNamed,
        findOrCreateChannelNamed,
        post,
      });
    });
    client.login(token);
  });
}
