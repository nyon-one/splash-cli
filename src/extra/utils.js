require("babel-polyfill");
require("regenerator-runtime");

import fetch from 'isomorphic-fetch';

import { prompt } from 'inquirer';
import isMonth from "@splash-cli/is-month";
import pathFixer from "@splash-cli/path-fixer";
import printBlock from "@splash-cli/print-block";
import showCopy from "@splash-cli/show-copy";
import chalk from "chalk";
import Conf from "conf";
import figures from 'figures';
import got from "got";
import isImage from 'is-image';
import { JSDOM } from "jsdom";
import mkdirp from "mkdirp";
import Ora from "ora";
import path from "path";
import RemoteFile from "simple-download";
import terminalLink from 'terminal-link';
import wallpaper from "wallpaper";
import http from 'http';
import { toJson } from "unsplash-js";

import { defaultSettings, unsplash } from "./config";



const config = new Conf();

export async function login() {
  const spinner = new Ora('Waiting...')

  http.createServer(async (req, res) => {
    res.send = (content, status = 200) => {
      res.writeHead(status)
      res.end(content)
    }

    if ( req.url.includes('code') ) {
      if (req.url.match(/code=(.*)/)[1]) {
        if (spinner) spinner.text = "Authenticating..."

        try {
          const code = req.url.match(/code=(.*)/)[1]

          unsplash.auth.userAuthentication(code)
            .then(toJson)
            .then(data => {
              unsplash.auth.setBearerToken(data.access_token);

              config.set('user', {
                token: data.access_token,
                refresh: data.refresh_token
              });

              spinner.stop()
              testUserAuth(data.access_token)
            })
        } catch (error) {
          spinner.fail("Failed.")
          errorHandler(error);
        }
      }
    }
  }).listen(5835, () => {
    const authURL = `https://unsplash.com/oauth/authorize?client_id=a70f2ffae3634a7bbb5b3f94998e49ccb2e85922fa3215ccb61e022cf57ca72c&redirect_uri=http%3A%2F%2Flocalhost%3A5835%2F&response_type=code&scope=public+write_likes+write_followers+read_collections+write_collections`

    printBlock(
      chalk`{yellow {bold Splash CLI:} Please click on the link below to login}`, 
      ``,
      chalk`{cyan {dim ${authURL}}}`
    )

    spinner.start();
  })
}

export async function authenticatedRequest(endpoint, options = {}) {
  if (!checkUserAuth()) return login();

  try {
    const { body } = await got(`https://api.unsplash.com/${endpoint}`, Object.assign({}, options, { headers: { 'Authorization': `Bearer ${token}` } }))

    return JSON.parse(body);
  } catch (error) {
    errorHandler(error);
  }
}

export async function updateMe() {
  if ( !checkUserAuth() ) return login();
  const user = config.get('current-user-profile') || {};
  // console.log(user)
  const data = await prompt([{
    name: 'username',
    message: 'Username',
    default: user.username,
  }, {
    name: 'firstName',
    message: 'First Name:',
    default: user.first_name,
  }, {
    name: 'lastName',
    message: 'Last Name',
    default: user.last_name
  }, {
    name: 'bio',
    message: 'Bio',
    default: user.bio
  }, {
    name: 'instagramUsername',
    message: 'Instagram Username',
    default: user.instagram_username
  }, {
    name: 'location',
    message: 'Location',
    default: user.location
  }, {
    name: 'url',
    message: 'Url',
    default: user.url
  }])

  return unsplash.currentUser().updateProfile(data).then(toJson)
}

export function checkUserAuth() {
  const { token } = config.get('user');
  const user = config.get('current-user-profile');

  if ( !token || !user ) return false;

  unsplash.auth.setBearerToken(config.get('user').token)
  return true;
}

async function testUserAuth(token) {
  try {
    const { body } = await got("https://api.unsplash.com/me", {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    })

    const user = JSON.parse(body);

    printBlock(chalk`{bold Welcome {cyan @${user.username}}!}`)
    config.set('current-user-profile', user)
    process.exit()
  } catch (error) {
    errorHandler(error)
  }
}

export async function clearSettings() {
  const settingsList = Object.keys(defaultSettings);

  for (let i = 0; i < settingsList.length; i++) {
    const setting = settingsList[i];

    if (config.has(setting)) {
      config.delete(setting);
      config.set(setting, defaultSettings[setting]);
    }
  }

  return config.get() === defaultSettings;
}

export const parseCollection = alias => {
  const aliases = config.get("aliases");

  if (aliases.length) {
    const collection = aliases.filter(item => item.name === alias)

    if (collection.length) {
      return collection[0].id;
    }

    return alias;
  }

  return alias;
};

export function errorHandler(error) {
  const spinner = new Ora();
  spinner.stop();
  printBlock(
    '',
    chalk `{bold {red OOps! We got an error!}}`,
    '',
    chalk `Please report it: {underline {green ${terminalLink('on GitHub', 'https://github.com/splash-cli/splash-cli/issues')}}}`,
    '',
    chalk `{yellow {bold Splash Error}:}`,
    '',
    '',
  );

  logger.error(error);
}

export function repeatChar(char, length) {
  var string = "";
  for (let i = 0; i < length; i++) {
    string += char;
  }

  return string;
}

export async function picOfTheDay() {
  const date = new Date();
  const today = `${date.getDay()}-${date.getMonth() + 1}-${date.getFullYear()}`;

  if (
    config.has("pic-of-the-day") &&
    config.get("pic-of-the-day").date == today
  ) {
    return config.get("pic-of-the-day").photo;
  }

  try {
    const {
      body: html
    } = await got("https://unsplash.com");

    const {
      window: {
        document
      }
    } = new JSDOM(html);
    const links = document.querySelectorAll("a");
    const photoOfTheDay = Object.keys(links)
      .map(key => {
        return links[key];
      })
      .filter(el => {
        const regex = new RegExp("Photo of the Day", "i");
        return regex.test(el.innerHTML);
      })
      .map(link => link.href)
      .shift()
      .match(/[a-zA-Z0-9_-]{11}/g)[0];

    config.set("pic-of-the-day", {
      date: today,
      photo: photoOfTheDay
    });

    // RETURNS THE ID OF THE PHOTO
    return photoOfTheDay;
  } catch (error) {
    errorHandler(error);
  }
}

export function isPath(string) {
  return /([a-z]\:|)(\w+|\~+|\.|)\\\w+|(\w+|\~+|)\/\w+/i.test(string);
}

export async function download(photo, url, flags, setAsWP = true) {
  let dir = config.get("directory");
  
  if (flags.quiet) {
    console.log = console.info = () => {};
    spinner.start = spinner.fail = () => {};
  }

  if (config.get("userFolder") === true) {
    dir = path.join(config.get("directory"), `@${photo.user.username}`);
  }

  mkdirp.sync(dir);

  const spinner = new Ora({
    text: "Making something awesome",
    color: "yellow",
    spinner: isMonth("december") ? "christmas" : "earth"
  });

  spinner.start();

  let filename = path.join(dir, `${photo.id}.jpg`);

  if (flags.save && isPath(flags.save)) {
    const savePath = pathFixer(flags.save);

    filename = path.join(savePath, `${photo.id}.jpg`);

    if (isImage(flags.save)) {
      filename = savePath;
    }
  }

  const remotePhoto = new RemoteFile(url, filename);
  
  remotePhoto.download().then(async fileInfo => {
    config.set("counter", config.get("counter") + 1);

    if (!flags.quiet) spinner.succeed();
    if (setAsWP && !flags.save) {

      if ( flags.screen || flags.scale ) {
        if (process.platform !== 'darwin') {
          console.log()
          console.log(chalk`{dim > Sorry, this function ({underline ${flags.screen ? '"screen"' : '"scale"'}}) is available {bold only on MacOS}}`)
          console.log()
        }
      }

      let screen;
      if ( flags.screen ) {
        if (!/[0-9|main|all]+/g.test(flags.screen)) {
          screen = false;
        } else {
          screen = flags.screen;
        }
      }

      let scale;
      if ( flags.scale ) {
        if (!/[auto|fill|fit|stretch|center]/g.test(flags.scale)) {
          scale = false;
        } else {
          scale = flags.scale;
        }
      }


      if ( scale ) {

        await wallpaper.set(filename, { scale });

      } else if ( screen ) {

        await wallpaper.set(filename, { screen });

      } else if ( scale && screen ) {

       await wallpaper.set(filename, { screen, scale });

      } else {

        await wallpaper.set(filename);

      }

    } else {
      console.log();
      printBlock(chalk `Picture stored at: {underline ${path.join(fileInfo.dir, fileInfo.base)}}`);
      console.log();
      return;
    }

    console.log();

    showCopy(photo, flags.info);

    console.log();
  });
}

export const logger = {
  info: console.log.bind(console, chalk.cyan(figures.info)),
  warn: console.log.bind(console, chalk.yellow(figures.warning)),
  error: console.log.bind(console, chalk.red(figures.cross)),
}