require('dotenv').config();

if (!process.env['PASSWORD']) {
    console.log('Error: $PASSWORD is not set');
    process.exit(1);
}

let GPIO_PINS = {
    'POWER': 24,
    'RESET': 23,
}

// Stores globally which GPIO pins are currently used, so that they're not triggered multiple times at once
let ACTIVE_ACTIONS = {
    [GPIO_PINS.POWER]: false,
    [GPIO_PINS.RESET]: false,
}

import Express from 'express';
import CookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import Crypto from 'crypto';

let hash = Crypto.createHash('sha256');
hash.update(process.env['PASSWORD']);
let HASHED_PASSWORD = hash.digest('hex');

/* Set up GPIO */
// Export pins. try/catched because the kernel returns `EBUSY` when already exported
try {
    fs.writeFileSync('/sys/class/gpio/export', String(GPIO_PINS.POWER));
    fs.writeFileSync('/sys/class/gpio/export', String(GPIO_PINS.RESET));
} catch(e) {}

// Set pins to output mode
fs.writeFileSync(`/sys/class/gpio/gpio${GPIO_PINS.POWER}/direction`, 'out');
fs.writeFileSync(`/sys/class/gpio/gpio${GPIO_PINS.RESET}/direction`, 'out');

const app = Express();
app.use(CookieParser());
const server = app.listen(3000, () => console.log('Listening on http://127.0.0.1:3000'));

const wsServer = new WebSocket.Server({ noServer: true });

// Authentication stuff.
// If `Authentication` cookie is not set or incorrect, the user
// will be redirected to /auth where they enter the password.
// The password is then stored in base64 in the `Authentication` cookie.
app.all('*', (req, res, next) => {
    let authCookie = req.cookies['Authentication'];
    let pwHash = Crypto.createHash('sha256').update(Buffer.from(authCookie || '', 'base64').toString('utf8')).digest('hex');

    if (pwHash === HASHED_PASSWORD) {
        console.log(`[INFO] GET ${req.originalUrl}`);
        if (req.path == '/auth') {
            res.redirect(req.query['return_to'] ? Buffer.from(req.query['return_to'].toString(), 'base64').toString('utf8') : '/');
        } else {
            next();
        }
    } else {
        if (req.method == 'GET') {
        console.log(`[INFO] (Unauthenticated) GET ${req.originalUrl}`);
            if (req.path == '/auth') {
                res.sendFile(path.join(__dirname, '..', 'auth.html'));
            } else {
                res.redirect(`/auth?return_to=${Buffer.from(req.url).toString('base64')}`);
            }
        } else {
            res
                .cookie('Authentication', '')
                .status(401)
                .send('Unauthorized');
        }
    }
});

app.get('/stream*', async (req, res) => {
    let path = req.path;
    if (!path.startsWith('/stream')) return res.send('Invalid request');
    path = path.substr('/stream'.length);
    if (path.length == 0) path = '/';

    let stats = fs.statSync('/dev/shm/streaming' + path);
    if (stats.isFile()) {
        res
            .header('Access-Control-Allow-Origin: *')
            .sendFile('/dev/shm/streaming' + path);
    } else {
        res
            .header('Access-Control-Allow-Origin: *')
            .status(404)
            .send(err404Msg);
    }
});

// Handle websocket stuff
server.on('upgrade', (request, socket, head) => {
    if (request.url != '/ws') {
        socket.write(err404Msg);
        socket.end();
        return;
    }
    wsServer.handleUpgrade(request, socket as any, head, (sock) => {
        wsServer.emit('connection', sock, request);
    });
});

wsServer.on('connection', socket => {
    let authenticated = false;
    socket.on('message', message => {
        console.log('[Info] WS Message: ' + message.toString());
        try {
            let data = JSON.parse(message.toString());
            if (data.type == 'AUTHENTICATE' && data.pass) {
                let pwHash = Crypto.createHash('sha256').update(Buffer.from(data.pass, 'base64').toString('utf8')).digest('hex');
                if (pwHash === HASHED_PASSWORD) {
                    console.log('WS authenticated successfully.');
                    authenticated = true;
                } else {
                    console.log('WS failed to authenticate.');
                    socket.send('Invalid password.');
                }
            } else if (data.type == 'BUTTON' && data.button && data.action) {
                if (authenticated == false) {
                    socket.send('Not authenticated. Send AUTHENTICATION message first.');
                    return;
                }

                let press_time;
                let pin: number;
                switch(data.action) {
                    case 'SHORT_PRESS': press_time = 500; break;
                    default: return;
                }
                switch(data.button) {
                    case 'POWER': pin = GPIO_PINS.POWER; break;
                    case 'RESET': pin = GPIO_PINS.RESET; break;
                    default: return;
                }

                if (ACTIVE_ACTIONS[pin] == true) return;

                ACTIVE_ACTIONS[pin] = true;
                fs.writeFileSync(`/sys/class/gpio/gpio${pin}/value`, '1');
                setTimeout(() => {
                    fs.writeFileSync(`/sys/class/gpio/gpio${pin}/value`, '0');
                    ACTIVE_ACTIONS[pin] = false;
                }, press_time);
            }
        } catch(e) {
            console.log('Error parsing WS response: ' + e);
        }
    });
});

app.use(Express.static(path.join(__dirname, '..', 'views')));

let err404Msg = 'The requested resource could not be found.';
