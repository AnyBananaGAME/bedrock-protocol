const { createServer } = require("../src/createServer");
const { Relay } = require("../src/relay");

let backend;

if(process.argv[2] === "sanctumterra") {
    backend = "sanctumterra";
} else if (process.argv[2] === "jsp-raknet") {
    backend = "jsp-raknet";
} else {
    const relay = new Relay({
        version: '1.21.50',
        host: '0.0.0.0',
        port: 19133,
        raknetBackend: "sanctumterra",
        destination: {
        host: 'zeqa.net',
        // host: '127.0.0.1',
          port: 19132
        }
      })
      relay.conLog = console.debug
      relay.listen() 

      relay.on('connect', player => {
        console.log('New connection', player.connection.address)
      
        player.on('clientbound_disconnect', ({ name, params }) => {
            params.message = 'Intercepted' // Change kick message to "Intercepted"
        });

        player.on('serverbound_text', ({ name, params }) => {
          if (name === 'text') { // Intercept chat message to server and append time.
            params.message += ".";
          }
        });
      });
    return;
}

const server = createServer({
    host: "0.0.0.0",
    port: 19133,
    maxPlayers: 100,
    raknetBackend: backend
});

server.conLog = console.log;
