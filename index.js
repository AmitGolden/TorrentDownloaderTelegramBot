'use strict';

const WebTorrent = require('webtorrent');
const Telegraf = require('telegraf');
const Axios = require('axios');
const Composer = require('telegraf/composer');
const session = require('telegraf/session');
const Stage = require('telegraf/stage');
const Markup = require('telegraf/markup');
const WizardScene = require('telegraf/scenes/wizard');
const Fs = require('fs');
const Path = require('path');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const client = new WebTorrent();

client.on('error', (err) => console.log(err));

function addTorrentMagnet(ctx, path) {
    const message = ctx.message.text;
    const torrent = client.add(message, { path: path }, function (torrent) { });

    torrent.on('error', (err) => ctx.reply(`Error downloading torrent: ${err}`));
    torrent.on('noPeers', () => ctx.reply(`Torrent: ${torrent.name} has no peers`));
    torrent.on('done', function () {
        ctx.reply(`Torrent: ${torrent.name} download finished`)
    });

}

async function addTorrentFile(ctx, path) {
    if (ctx.message.document.file_id !== undefined) {
        const fileId = ctx.message.document.file_id;
        const url = await ctx.telegram.getFileLink(fileId);
        const torrent = client.add(url, { path: path }, function (torrent) { });

        torrent.on('error', (err) => ctx.reply(`Error downloading torrent: ${err}`));
        torrent.on('noPeers', () => ctx.reply(`Torrent: ${torrent.name} has no peers`));
        torrent.on('done', function () {
            ctx.reply(`Torrent: ${torrent.name} download finished`)
        });
    }
    else
        ctx.reply('A proper file wasn\'t sent, please retry');
}

async function downloadFile(ctx, url, path) {
    path = Path.resolve(path, ctx.message.document.file_name);

    const writer = Fs.createWriteStream(path);

    const response = await Axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    });
}

const mediaTypeHandlerTor = new Composer();
mediaTypeHandlerTor.action('movie', ctx => {
    ctx.wizard.state.mediaType = 'movie';
    return askTorrentSource(ctx);
});
mediaTypeHandlerTor.action('tv', ctx => {
    ctx.wizard.state.mediaType = 'tv';
    return askTorrentSource(ctx);
});
mediaTypeHandlerTor.action('music', ctx => {
    ctx.wizard.state.mediaType = 'music';
    return askTorrentSource(ctx);
});
mediaTypeHandlerTor.action('other', ctx => {
    ctx.wizard.state.mediaType = 'other';
    return askTorrentSource(ctx);
});

const askTorrentSource = (ctx) => {
    ctx.reply('Is a .torrent file or a magnet URL?', Markup.inlineKeyboard([
        Markup.callbackButton("Magnet 🧲", "magnet"),
        Markup.callbackButton("File 📁", "file")
    ]).extra());
    return ctx.wizard.next();
};

const torrentSourceHandler = new Composer();
torrentSourceHandler.action('magnet', ctx => {
    ctx.wizard.state.torrentSource = 'magnet';
    ctx.reply('Enter magnet URL (or send "abort" to cancel):');
    return ctx.wizard.next();
});
torrentSourceHandler.action('file', ctx => {
    ctx.wizard.state.torrentSource = 'file';
    ctx.reply('Send the .torrent file (or send "abort" to cancel):');
    return ctx.wizard.next();
});

const torrentWiz = new WizardScene('torrentWiz',
    (ctx) => {
        ctx.reply('In which directory will it be?', Markup.inlineKeyboard([
            Markup.callbackButton("Movies 🎬", "movie"),
            Markup.callbackButton("TV Shows 📺", "tv"),
            Markup.callbackButton("Music 🎵", "music"),
            Markup.callbackButton("Other", "other")
        ]).extra());
        return ctx.wizard.next();
    },
    mediaTypeHandlerTor,
    torrentSourceHandler,
    (ctx) => {
        if (ctx.message === undefined)
            return ctx.scene.leave();
        if (ctx.message.text === 'abort') {
            ctx.reply('Abortting.');
            return ctx.scene.leave();
        }

        const path = ctx.wizard.state.mediaType === "other" ? process.env.OUTPUT_DIR : `${process.env.OUTPUT_DIR}/${ctx.wizard.state.mediaType}`;

        if (ctx.wizard.state.torrentSource === "magnet")
            addTorrentMagnet(ctx, path);
        else addTorrentFile(ctx, path);

        ctx.reply('Done!');

        ctx.reply(
            `How can I help you, ${ctx.from.first_name}?`,
            Markup.inlineKeyboard([
                Markup.callbackButton("Download a torrent ⬇️", "torrent"),
                Markup.callbackButton("Download a file 📁", "file")
            ]).extra()
        );

        return ctx.scene.leave();
    }
);

const mediaTypeHandlerFile = new Composer();
mediaTypeHandlerFile.action('movie', ctx => {
    ctx.wizard.state.mediaType = 'movie';
    return askSendFile(ctx);
});
mediaTypeHandlerFile.action('tv', ctx => {
    ctx.wizard.state.mediaType = 'tv';
    return askSendFile(ctx);
});
mediaTypeHandlerFile.action('music', ctx => {
    ctx.wizard.state.mediaType = 'music';
    return askSendFile(ctx);
});
mediaTypeHandlerFile.action('other', ctx => {
    ctx.wizard.state.mediaType = 'other';
    return askSendFile(ctx);
});

const askSendFile = (ctx) => {
    ctx.reply('Send the file: (or send "abort" to cancel)');
    return ctx.wizard.next();
};

const fileWiz = new WizardScene('fileWiz',
    ctx => {
        ctx.reply('In which directory will it be?', Markup.inlineKeyboard([
            Markup.callbackButton("Movies 🎬", "movie"),
            Markup.callbackButton("TV Shows 📺", "tv"),
            Markup.callbackButton("Music 🎵", "music"),
            Markup.callbackButton("Other", "other")
        ]).extra());
        return ctx.wizard.next();
    },
    mediaTypeHandlerFile,
    ctx => {
        if (ctx.message === undefined)
            return ctx.scene.leave();
        if (ctx.message.text === 'abort') {
            ctx.reply('Abortting.');
            return ctx.scene.leave();
        }
        const path = ctx.wizard.state.mediaType === "other" ? process.env.OUTPUT_DIR : `${process.env.OUTPUT_DIR}/${ctx.wizard.state.mediaType}`;
        try {
            const fileId = ctx.message.document.file_id;
            ctx.telegram.getFileLink(fileId)
                .then((url) => downloadFile(ctx, url, path)
                    .then(() => ctx.reply(`File: ${ctx.message.document.file_name} download finished successfully!`))
                    .catch(() => ctx.reply(`Error: could not download file: ${ctx.message.document.file_name}`)));
        }
        catch (error) {
            ctx.reply('A proper file wasn\'t sent, please try again');
        }

        ctx.reply(
            `How can I help you, ${ctx.from.first_name}?`,
            Markup.inlineKeyboard([
                Markup.callbackButton("Download a torrent ⬇️", "torrent"),
                Markup.callbackButton("Download a file 📁", "file")
            ]).extra()
        );

        return ctx.scene.leave();
    }
);

const stage = new Stage();
stage.register(torrentWiz);
stage.register(fileWiz);

bot.start(ctx => {
    if (ctx.scene !== undefined)
        ctx.scene.leave();
    ctx.reply(
        `How can I help you, ${ctx.from.first_name}?`,
        Markup.inlineKeyboard([
            Markup.callbackButton("Download a torrent ⬇️", "torrent"),
            Markup.callbackButton("Download a file 📁", "file")
        ]).extra()
    );
});

bot.use(session());
bot.use(stage.middleware());

bot.action("torrent", ctx => {
    if (ctx.scene !== undefined)
        ctx.scene.leave();
    ctx.scene.enter('torrentWiz')
});
bot.command("torrent", ctx => {
    if (ctx.scene !== undefined)
        ctx.scene.leave();
    ctx.scene.enter('torrentWiz')
});
bot.action("file", ctx => {
    if (ctx.scene !== undefined)
        ctx.scene.leave();
    ctx.scene.enter('fileWiz')
});
bot.command("file", ctx => {
    if (ctx.scene !== undefined)
        ctx.scene.leave();
    ctx.scene.enter('fileWiz')
});

bot.launch();