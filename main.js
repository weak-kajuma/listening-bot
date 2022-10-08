/* Required Modules */
const { entersState, joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType } = require('@discordjs/voice');
const { createWriteStream } = require('node:fs');
const prism = require('prism-media');
const { pipeline } = require('node:stream');
const { Client, Intents, MessageAttachment, Collection } = require('discord.js');
const ffmpeg = require('ffmpeg');
const sleep = require('util').promisify(setTimeout);
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const apiServer = ""
const TOKEN = ""

/* Initialize Discord Client */
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MEMBERS,
        Intents.FLAGS.GUILD_VOICE_STATES
    ]
})

/* Collection to store voice state */
client.voiceManager = new Collection()

/* Ready event */
client.on("ready", () => {
    console.log("Connected as", client.user.tag, "to discord!");
})

/* When message is sent*/
client.on('messageCreate', async (message) => {
    /* If member do not have admin perms */
    if (!message.member.permissions.has('ADMINISTRATOR')) return message.channel.send('You do not have permission to use this command.'); 
    /* Get the voice channel the user is in */
    const voiceChannel = message.member.voice.channel
    /* Check if the bot is in voice channel */
    let connection = client.voiceManager.get(message.channel.guild.id)

    /* If content starts with `!ls start` */
    if (message.content.startsWith('!ls start')) {

        /* If the bot is not in voice channel */
        if (!connection) {
            /* if user is not in any voice channel then return the error message */
            if(!voiceChannel) return message.channel.send("You must be in a voice channel to use this command!")

            /* Join voice channel*/
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                selfDeaf: false,
                selfMute: true,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            /* Add voice state to collection */
            client.voiceManager.set(message.channel.guild.id, connection);
            await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
            const receiver = connection.receiver;

            /* When user speaks in vc*/
            receiver.speaking.on('start', (userId) => {
                if(userId !== message.author.id) return;
                /* create live stream to save audio */
                createListeningStream(receiver, userId, client.users.cache.get(userId), message);
            });

            /* Return success message */
            return message.channel.send(`🎙️ I am now listening ${voiceChannel.name}`);
        
            /* If the bot is in voice channel */
        }
    
    /* If content starts with `!ls stop` */
    } else if (message.content.startsWith('!ls stop')) {
        /* Send waiting message */
        const msg = await message.channel.send("Please wait a little more...")

        /* disconnect the bot from voice channel */
        connection.destroy();

        /* Remove voice state from collection */
        client.voiceManager.delete(message.channel.guild.id)

        // tell user the end
        msg.edit({
            content: `Thank You For Using This Bot.`
        })
    }
})


client.login(TOKEN)



//------------------------- F U N C T I O N S ----------------------//

/* Function to write audio to file (from discord.js example) */
const createListeningStream = async (receiver, userId, user, message) => {
    const opusStream = receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 100,
        },
    });

    const oggStream = new prism.opus.OggLogicalBitstream({
        opusHead: new prism.opus.OpusHead({
            channelCount: 2,
            sampleRate: 48000,
        }),
        pageSizeControl: {
            maxPackets: 10,
        },
    });

    const filename = `./recordings/${getDate()}-${user.id}`;

    const out = createWriteStream(`${filename}.pcm`, { flags: 'a' });
    console.log(`👂 Started recording ${filename}.pcm`);

    pipeline(opusStream, oggStream, out, async (err) => {
        if (err) {
            console.warn(`❌ Error recording file ${filename}.pcm - ${err.message}`);
        } else {
            await convertMp3(filename, message)
        }
    });
};

const convertMp3 = async (filename, message) => {
    const process = new ffmpeg(`${filename}.pcm`);
    process.then(function (audio) {
        audio.fnExtractSoundToMP3(`${filename}.mp3`, async function (error, file) {
            // after convertMp3
            console.log(`✅ Recorded ${filename}.mp3`);
            await upload(`${filename}.mp3`).then(resp => console.log(resp));
            const fileText = await getUploadFileText(filename);
            message.channel.send(`${message.author.username}: ${fileText}`)
        });
    }, function (err) {
        /* handle error by sending error message to discord */
        message.channel.send(`❌ An error occurred while processing your recording: ${err.message}`);
    });
};

const getDate = () => {
    const nowTime = new Date();
    const year = nowTime.getFullYear();
    const month = nowTime.getMonth();
    const date = nowTime.getDate();
    const hour = nowTime.getHours();
    const min  = nowTime.getMinutes();
    const sec  = nowTime.getSeconds();
    return `${year}-${month}-${date}-${hour}-${min}-${sec}`
};

const upload = async (filename) => {
    try {
      const file = fs.createReadStream(filename);
      const title = 'filename';
      
      const form = new FormData();
      form.append('title', title);
      form.append('file', file);
      
      const resp = await axios.post(apiServer, form, {
        headers: {
          ...form.getHeaders(),
        }
      });
      
      if (resp.status === 200) {
        return 'Upload complete';
      } 
    } catch(err) {
      return new Error(err.message);
    }
}

const getUploadFileText = async (filename) => {
    while (true) {
        const res = await axios.get(`${apiServer}${filename.substring(12)}.mp3`)
        if (res.data.text) {
            return res.data.text
        } else {
            sleep(2)
        }
    }
}