const express = require('express')
const app = express()
const path = require('path');
const {MongoClient,ServerApiVersion} = require('mongodb');
const bcrypt = require('bcrypt'); // Used for password hashing
const saltRounds = 10; //any number , we could fix it as 10 for simplicity
const session = require('express-session');
require('dotenv').config({
    path: '../.env'
}); // This points to the .env in the root folder

// setup for .env file for base Url for mongodb
const uri = "mongodb://localhost:27017/";
const key = "6UfZN0VdbW9A9U2ioUtHVRVjmYOPoMTA";

console.log('MongoDB URI:', uri);


app.use(session({
    secret: key, // Replace with a secure key
    resave: false, // Prevents session being saved repeatedly
    saveUninitialized: true, // Saves a new session even if it is not modified
    cookie: {
        secure: false
    } // Set to true if using HTTPS
}));


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Define the database and collection
const dbName = 'myDB';  //project requirement
const collectionName = 'myCollection';
let db, usersCollection;

// Connect to MongoDB and get the users collection
async function connectDb() {
    await client.connect();
    db = client.db(dbName);
    usersCollection = db.collection(collectionName);
}

// Setup Express middleware to parse JSON request bodies
app.use(express.json());
app.use(express.urlencoded({
    extended: true
})); // For parsing form data


// Set the 'views' directory
app.set('views', path.join(__dirname, '../views'));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Set the view engine to EJS as required
app.set('view engine', 'ejs');


// each routing path will be done like that it could also be done 
// in a separate routes folder if it overwhelmed us
// req is the request payload and the res is the response generated by the server

// TODO place all get to redirect to the correct locations , insure rest of routes handle ONLY the user who made a login or a registration
app.get(['/', '/login'], (req, res) => {
    res.render('login.ejs');
});

app.get('/registration', (req, res) => {
    res.render('registration.ejs');
});

app.get('/home', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Redirect to login if no session user
    }
    res.render('home.ejs'); // Render home page if session user exists
});

app.get('*', (req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
 });
//POST METHODS
// Login Route (POST method to check credentials)
app.post(['/', '/login'], async (req, res) => {
    const { username, password } = req.body;
    let allowLogin = false;

    console.log("Username:", username);
    console.log("Password:", password);

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }

    if (username === 'admin' && password === 'admin') {
        allowLogin = true;
    }

    try {
        await connectDb();

        if (!allowLogin) {
            // Check if the user exists in the database
            const user = await usersCollection.findOne({ username });
            console.log("User from database:", user);

            if (!user) {
                return res.status(401).json({ error: "User does not exist" });
            }

            // Compare the entered password with the stored hashed password
            const isMatch = await bcrypt.compare(password, user.passwordHash); // Use 'passwordHash'

            if (!isMatch) {
                return res.status(401).json({ error: "Invalid credentials." });
            }

            // Store user information in the session
            req.session.user = { username: user.username };

            return res.status(200).json({ message: "Login successful!" }); // Only one response here
        }

        // If allowLogin is true (admin login)
        req.session.user = { username: 'admin' };

        return res.status(200).json({ message: "Login successful!" }); // Only one response here
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error logging in." });
    }
});

app.post('/registration', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }

    try {
        await connectDb();

        // Check if the username is already taken
        const user = await usersCollection.findOne({ username, type: "user" });
        if (user) {
            return res.status(401).json({ error: "Username is already taken. Please choose another one." });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Save the user to the database
        const newUser = {
            type: "user", // Discriminator field
            username,
            passwordHash: hashedPassword, // Correct field name for hashed password
            wantToGoList: [] // Initialize with an empty list
        };

        const result = await usersCollection.insertOne(newUser);

        res.status(201).json({ message: "User registered successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error registering user." });
    }
});

app.post('/search', async(req,res)=>{
    const {searchKey} = req.body;
    if (!searchKey )         
        return res.status(400).json({ error: "Username and password are required." });
    try{
        await connectDb();

        // searching for destinations
        const destinations = await usersCollection.find({
            type: "destination", // Only search destination documents
            name: { $regex: searchKey, $options: "i" } // Case-insensitive substring search
        }).toArray();

        if (destinations.length === 0){
            return res.status(400).json({ error: "No matching destinations found" });

        }

        res.status(200).json({ destinations });
    }
    catch{
        console.error("Error searching destinations:", err);
        res.status(500).json({ error: "Error searching destinations." });
    }

});

// Start the server on the port you need , specifically 3000 for simplicity
app.listen(3000, () => {
    console.log('Server started on port 3000');
});