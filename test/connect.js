const { createClient } = require("../src/createClient");

const client = createClient({
    host: "127.0.0.1",
    port: 19132,
    raknetBackend: "sanctumterra",
    offline: false,
    version: "1.21.50"
});


client.on("text", (packet) => {
    console.log(packet);
});

// client.connect();