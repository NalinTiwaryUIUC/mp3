var mongoose = require('mongoose');

function fail(status, message) {
    throw Object.assign(new Error(message), { status: status });
}

function validId(id) {
    return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

async function findDocument(Model, id, session) {
    if (!validId(id)) fail(404, Model.modelName + ' not found');

    var document = await Model.findById(id).session(session);
    if (!document) fail(404, Model.modelName + ' not found');

    return document;
}

function bodyObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        fail(400, 'Request body must be an object');
    }
}

function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        fail(400, field + ' must be a nonempty string');
    }

    return value.trim();
}

function userFields(body) {
    bodyObject(body);

    var name = requiredString(body.name, 'name');
    var email = requiredString(body.email, 'email');

    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
        fail(400, 'email must be a valid email address');
    }

    var pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;

    if (!Array.isArray(pendingTasks) || !pendingTasks.every(validId)) {
        fail(400, 'pendingTasks must be an array of valid task IDs');
    }

    return {
        name: name,
        email: email,
        pendingTasks: [...new Set(pendingTasks.map(id => id.toLowerCase()))]
    };
}

function taskFields(body) {
    bodyObject(body);

    var name = requiredString(body.name, 'name');
    var deadline = body.deadline;

    if (
        !['string', 'number'].includes(typeof deadline) ||
        (typeof deadline === 'string' && !deadline.trim()) ||
        !Number.isFinite(new Date(deadline).getTime())
    ) {
        fail(400, 'deadline must be a valid date');
    }

    var description = body.description === undefined ? '' : body.description;
    var completed = body.completed === undefined ? false : body.completed;
    var assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;

    if (typeof description !== 'string') {
        fail(400, 'description must be a string');
    }

    if (typeof completed !== 'boolean') {
        fail(400, 'completed must be a boolean');
    }

    if (assignedUser !== '' && !validId(assignedUser)) {
        fail(400, 'assignedUser must be a valid user ID or an empty string');
    }

    if (
        body.assignedUserName !== undefined &&
        typeof body.assignedUserName !== 'string'
    ) {
        fail(400, 'assignedUserName must be a string');
    }

    return {
        name: name,
        description: description,
        deadline: new Date(deadline),
        completed: completed,
        assignedUser: assignedUser.toLowerCase(),
        assignedUserName: 'unassigned'
    };
}

function parameter(query, key, fallback) {
    if (query[key] === undefined) return fallback;

    if (typeof query[key] !== 'string') {
        fail(400, key + ' must be a JSON value');
    }

    try {
        return JSON.parse(query[key]);
    } catch {
        fail(400, key + ' must contain valid JSON');
    }
}

function objectParameter(query, key) {
    var value = parameter(query, key, {});

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(400, key + ' must be a JSON object');
    }

    return value;
}

function projection(query) {
    var select = objectParameter(query, 'select');

    if (!Object.values(select).every(value => value === 0 || value === 1)) {
        fail(400, 'select values must be 0 or 1');
    }

    var modes = new Set(
        Object.entries(select)
            .filter(([key]) => key !== '_id')
            .map(([, value]) => value)
    );

    if (modes.size > 1) {
        fail(400, 'select cannot mix inclusion and exclusion');
    }

    return select;
}

async function list(Model, req, res, defaultLimit) {
    var where = objectParameter(req.query, 'where');
    var sort = objectParameter(req.query, 'sort');
    var select = projection(req.query);
    var skip = parameter(req.query, 'skip', 0);
    var limit = parameter(req.query, 'limit', defaultLimit);
    var count = parameter(req.query, 'count', false);

    if (!Object.values(sort).every(value => value === 1 || value === -1)) {
        fail(400, 'sort values must be 1 or -1');
    }

    if (
        !Number.isSafeInteger(skip) || skip < 0 ||
        !Number.isSafeInteger(limit) || limit < 0
    ) {
        fail(400, 'skip and limit must be nonnegative integers');
    }

    if (typeof count !== 'boolean') {
        fail(400, 'count must be a boolean');
    }

    var query = count
        ? Model.countDocuments(where)
        : Model.find(where).sort(sort).select(select).skip(skip).limit(limit);

    var data;

    try {
        data = await query.exec();
    } catch (err) {
        if (
            err.name === 'CastError' ||
            [2, 9, 14, 168, 31253, 31254].includes(err.code)
        ) {
            fail(400, 'Invalid query parameters');
        }

        throw err;
    }

    res.json({ message: 'OK', data: data });
}

async function get(Model, req, res) {
    if (!validId(req.params.id)) {
        fail(404, Model.modelName + ' not found');
    }

    var document = await Model.findById(req.params.id)
        .select(projection(req.query));

    if (!document) fail(404, Model.modelName + ' not found');

    res.json({ message: 'OK', data: document });
}

module.exports = {
    fail,
    findDocument,
    userFields,
    taskFields,
    list,
    get,
    transaction: work => mongoose.connection.transaction(work)
};