var net  = require("net");
var http = require("http");
var url  = require("url");
var util = require("util");

module.exports = {
    createServer: createServer
};

function createServer (handler) {
    var server =  http.createServer(function (req, res) {
        var u = url.parse(req.url);
        var host = u.host;
        var port = u.port || 80;
        var path = u.path;
        start(host, port, path, req, res, handler);
    });

    server.on("clientError", function (ex) {
        console.warn("Client error: ");
        console.dir(ex);
    });

    server.on("close", function () {
        console.warn("Server closed");
    });

    server.on('upgrade', function (req, socket, head) {
        socket.on("error", function (err) {
            console.warn("Socket error with upgraded connection to " + req.url + ":");
            console.dir(err);
        });

        socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n' +
                     'Upgrade: WebSocket\r\n' +
                     'Connection: Upgrade\r\n' +
                     '\r\n');
        socket.pipe(socket);
    });

    server.on("connect", function (req, clientSocket, head) {
        clientSocket.on("error", function (err) {
            console.warn("Client socket error while connecting to " + req.url + ":");
            console.dir(err);
        });

        var serverUrl = url.parse('http://' + req.url);
        var serverSocket = net.connect(serverUrl.port, serverUrl.hostname, function () {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                               'Proxy-agent: node-proxy\r\n' +
                               '\r\n');
            serverSocket.write(head);
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });

        serverSocket.on("error", function (err) {
            console.warn("Server socket error while connecting to " + req.url + ":");
            console.dir(err);
        });
    });

    return server;
}

function start (host, port, path, req, res, handler) {
    var ended = false;
    var closed = false;
    var buffer = [];
    var req2 = false;

    req.on("data", function (chunk) {
        if (req2) {
            req2.write(chunk);
        } else {
            buffer.push(chunk);
        }
    });
    req.on("end", function () {
        if (req2) {
            req2.end();
        }
        ended = true;
    });
    req.on("close", function () {
        if (req2 && !ended) {
            req2.end();
        }
        closed = true;
    });

    // if (req.headers["proxy-connection"] === "keep-alive" && !req.headers["connection"]) {
    //     req.connection.setKeepAlive(true);
    //     req.headers["connection"] = "keep-alive";
    // }

    handler(host, port, path, req, res, function (host, port, path, req, res, callback) {
        req2 = proxy(host, port, path, req, res, callback);

        // if (req.headers["connection"] === "keep-alive") {
        //     req2.setSocketKeepAlive(true);
        // }

        req2.on("error", function (e) {
            res.destroy();
        });

        buffer.forEach(function (chunk) {
            req2.write(chunk);
        });
        if (ended || closed) {
            req2.end();
        }
    });
}

function proxy (host, port, path, req, res, callback) {
    var options;

    for (var k in req.headers) {
        if (k.match(/^proxy-/)) {
            delete req.headers[k];
        }
    }

    if (!host) {
        options = {socketPath: port, path: path, method: req.method, headers: req.headers};
    } else {
        options = {host: host, port: port, path: path, method: req.method, headers: req.headers};
    }

    return http.request(options, function (res2) {
        res.writeHead(res2.statusCode, res2.headers);
        var closed = false;
        res2.on("data", function (chunk) { res.write(chunk); });
        res2.on("end", function () {
            closed = true;
            res.end();
            callback && callback();
        });
        res2.on("close", function () {
            if (closed) {
                // do nothing
            } else {
                res.end();
                callback && callback();
            }
        });
    });
}
