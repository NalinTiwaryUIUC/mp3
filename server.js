// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose');

// Read .env file
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;

// Connect to a MongoDB --> Uncomment this once you have a connection string!!
var connection = mongoose.connect(process.env.MONGODB_URI);

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    next();
};
app.use(allowCrossDomain);

// Parse URL-encoded and JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

app.use(function (req, res) {
    res.status(404).json({ message: 'Endpoint not found', data: null });
});

app.use(function (err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    var status = 500;
    var message = 'An unexpected server error occurred';

    if (err.type === 'entity.parse.failed') {
        status = 400;
        message = 'Request body must contain valid JSON';
    } else if (err.code === 11000) {
        status = 400;
        message = 'Email is already in use';
    } else if (
        err.name === 'ValidationError' ||
        err.name === 'CastError'
    ) {
        status = 400;
        message = 'One or more fields contain invalid values';
    } else if (err.status === 400 || err.status === 404) {
        status = err.status;
        message = err.message;
    }

    res.status(status).json({ message: message, data: null });
});

// Start the server
connection.then(async function () {
    await Promise.all([
        require('./models/user').init(),
        require('./models/task').init()
    ]);

    app.listen(port);
    console.log('Server running on port ' + port);
}).catch(function (err) {
    console.error('Server startup failed:', err.name);
    process.exitCode = 1;
});