const mongoose = require('mongoose');


// For connecting to cloud 
// mongoose.connect('mongodb+srv://dbAdmin:Caavn0WU6vt278Jm@cluster0-ouigf.mongodb.net/test?retryWrites=true&w=majority', { useNewUrlParser: true }, (err) => {
  

// For local db
// mongoose.connect('mongodb://localhost:27017/EmployeeDB',
  
mongoose.connect('mongodb://localhost:27017/EmployeeDB', { useNewUrlParser: true }, (err) => {
    if (!err) { console.log('MongoDB Connection Succeeded.') }
    else { console.log('Error in DB connection : ' + err) }
});

require('./employee.model');