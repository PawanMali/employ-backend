const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://dbadmin:Caavn0WU6vt278Jm@cluster0-ouigf.mongodb.net/test?retryWrites=true&w=majority', { useNewUrlParser: true }, (err) => {
    if (!err) { console.log('MongoDB Connection Succeeded.') }
    else { console.log('Error in DB connection : ' + err) }
});

require('./employee.model');