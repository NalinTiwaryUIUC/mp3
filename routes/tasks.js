var User = require('../models/user');
var Task = require('../models/task');
var api = require('./helpers');

async function saveTask(body, id, session) {
    var task = id === undefined
        ? new Task()
        : await api.findDocument(Task, id, session);

    var fields = api.taskFields(body);

    if (fields.assignedUser) {
        var user = await api.findDocument(User, fields.assignedUser, session);

        if (
            body.assignedUserName !== undefined &&
            body.assignedUserName !== user.name
        ) {
            api.fail(400, 'assignedUserName does not match the assigned user');
        }

        fields.assignedUserName = user.name;
    }

    var previousUser = task.assignedUser;
    var taskId = task._id.toString();

    task.set(fields);
    await task.save({ session: session });

    if (previousUser) {
        await User.updateOne(
            { _id: previousUser },
            { $pull: { pendingTasks: taskId } },
            { session: session }
        );
    }

    if (task.assignedUser && !task.completed) {
        await User.updateOne(
            { _id: task.assignedUser },
            { $addToSet: { pendingTasks: taskId } },
            { session: session }
        );
    }

    return task;
}

module.exports = function (router) {
    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(function (req, res) {
        return api.list(Task, req, res, 100);
    });

    tasksRoute.post(async function (req, res) {
        var task = await api.transaction(
            session => saveTask(req.body, undefined, session)
        );

        res.status(201).json({ message: 'Task created', data: task });
    });

    taskRoute.get(function (req, res) {
        return api.get(Task, req, res);
    });

    taskRoute.put(async function (req, res) {
        var task = await api.transaction(
            session => saveTask(req.body, req.params.id, session)
        );

        res.json({ message: 'Task updated', data: task });
    });

    taskRoute.delete(async function (req, res) {
        await api.transaction(async function (session) {
            var task = await api.findDocument(Task, req.params.id, session);

            await User.updateMany(
                { pendingTasks: task._id.toString() },
                { $pull: { pendingTasks: task._id.toString() } },
                { session: session }
            );

            await task.deleteOne({ session: session });
        });

        res.json({ message: 'Task deleted', data: {} });
    });

    return router;
};