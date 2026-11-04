var User = require('../models/user');
var Task = require('../models/task');
var api = require('./helpers');

async function saveUser(body, id, session) {
    var user = id === undefined
        ? new User()
        : await api.findDocument(User, id, session);

    var fields = api.userFields(body);

    var duplicate = await User.findOne({
        email: fields.email,
        _id: { $ne: user._id }
    }).session(session);

    if (duplicate) api.fail(400, 'Email is already in use');

    var tasks = await Task.find({
        _id: { $in: fields.pendingTasks }
    }).session(session);

    if (tasks.length !== fields.pendingTasks.length) {
        api.fail(404, 'A referenced task was not found');
    }

    if (tasks.some(task => task.completed)) {
        api.fail(400, 'pendingTasks cannot contain completed tasks');
    }

    var oldTasks = user.pendingTasks.slice();
    var userId = user._id.toString();

    user.set(fields);
    await user.save({ session: session });

    await Task.updateMany(
        {
            _id: { $in: oldTasks, $nin: fields.pendingTasks },
            assignedUser: userId
        },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
        { session: session }
    );

    await User.updateMany(
        {
            _id: { $ne: user._id },
            pendingTasks: { $in: fields.pendingTasks }
        },
        { $pull: { pendingTasks: { $in: fields.pendingTasks } } },
        { session: session }
    );

    await Task.updateMany(
        { _id: { $in: fields.pendingTasks } },
        { $set: { assignedUser: userId, assignedUserName: user.name } },
        { session: session }
    );

    await Task.updateMany(
        { assignedUser: userId },
        { $set: { assignedUserName: user.name } },
        { session: session }
    );

    return user;
}

module.exports = function (router) {
    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(function (req, res) {
        return api.list(User, req, res, 0);
    });

    usersRoute.post(async function (req, res) {
        var user = await api.transaction(
            session => saveUser(req.body, undefined, session)
        );

        res.status(201).json({ message: 'User created', data: user });
    });

    userRoute.get(function (req, res) {
        return api.get(User, req, res);
    });

    userRoute.put(async function (req, res) {
        var user = await api.transaction(
            session => saveUser(req.body, req.params.id, session)
        );

        res.json({ message: 'User updated', data: user });
    });

    userRoute.delete(async function (req, res) {
        await api.transaction(async function (session) {
            var user = await api.findDocument(User, req.params.id, session);

            await Task.updateMany(
                { assignedUser: user._id.toString() },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
                { session: session }
            );

            await user.deleteOne({ session: session });
        });

        res.json({ message: 'User deleted', data: {} });
    });

    return router;
};