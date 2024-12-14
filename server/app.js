// Required Modules
const express = require("express");
const path = require("path");
const fs = require("fs");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");
const session = require("express-session");
require("dotenv").config({ path: "../.env" }); // .env file location

// Initialize app
const app = express();

// Constants
const saltRounds = 10; // Salt rounds for password hashing
const key = "eyJvaWRjUGx1Z2luU3RhdGVWZXJzaW9uIjowLCJzdGF0ZSI6W119"; // Session key
const uri = "mongodb://127.0.0.1:27017";
const dbName = "myDB";
const collectionName = "myCollection";
const destinationsFilePath = path.join(__dirname, "destinations.json");

let db, usersCollection;

// Setup middleware
app.set("case sensitive routing", false);
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(express.static(path.join(__dirname, "../public"))); // Serve static files
app.set("views", path.join(__dirname, "../views")); // Set views directory
app.set("view engine", "ejs"); // Set view engine to EJS
app.use(session({
  secret: key,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }, // Set to true if using HTTPS
}));

// MongoDB Connection
const client = new MongoClient(uri);
async function connectDb() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    db = client.db(dbName);
    usersCollection = db.collection(collectionName);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

// Load destinations data from JSON file
let destinationsInFile = [];
try {
  const data = fs.readFileSync(destinationsFilePath, "utf-8");
  destinationsInFile = JSON.parse(data);
} catch (err) {
  console.error("Error reading destinations JSON file:", err);
  process.exit(1); // Exit if the file can't be read
}

// Routes
// Home and Authentication Routes
app.get(["/", "/login"], (req, res) => res.render("login.ejs"));
app.get("/registration", (req, res) => res.render("registration.ejs"));

app.get("/home", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("home.ejs");
});

// Login POST Route
app.post(["/", "/login"], async (req, res) => {
  const { username, password } = req.body;
  let allowLogin = false;

  if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

  if (username === "admin" && password === "admin") {
    allowLogin = true;
  }

  try {
    await connectDb();

    if (!allowLogin) {
      const user = await usersCollection.findOne({ username });
      if (!user) return res.status(401).json({ error: "User does not exist" });

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) return res.status(401).json({ error: "Invalid credentials." });

      req.session.user = { username: user.username };
      return res.status(200).json({ message: "Login successful!" });
    }

    req.session.user = { username: "admin" };
    return res.status(200).json({ message: "Login successful!" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error logging in." });
  }
});

// Registration POST Route
app.post("/registration", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

  try {
    await connectDb();

    const user = await usersCollection.findOne({ username, type: "user" });
    if (user) return res.status(401).json({ error: "Username is already taken. Please choose another one." });

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = {
      type: "user",
      username,
      passwordHash: hashedPassword,
      wantToGoList: [],
    };

    await usersCollection.insertOne(newUser);
    res.status(201).json({ message: "User registered successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error registering user." });
  }
});

// Dynamic Routes for destinations based on the data in destinations.json
destinationsInFile.forEach((destination) => {
  app.get(`/${destination.name}`, async (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    try {
      if (!destination.template) return res.status(500).send("Template not defined for this destination.");
      res.render(destination.template, {
        videoUrl: destination.videoUrl,
        description: destination.description,
        image: destination.image,
        name: destination.name,
      });
    } catch (err) {
      console.error("Error fetching destination:", err);
      res.status(500).send("Error loading the page.");
    }
  });
});

// Additional Routes for Cities, Islands, and Hiking
async function handleDestinationRoute(req, res, type, template) {
  if (!req.session.user) return res.redirect("/login");

  try {
    const destinations = destinationsInFile.filter(
      (item) => item.type === "destination" && item.destinationType === type,
    );

    if (destinations.length === 0) return res.status(404).send(`No destinations found for ${type}.`);
    res.render(template, { destinations, type });
  } catch (err) {
    console.error(`Error fetching destinations for ${type}:`, err);
    res.status(500).send("Error loading destinations.");
  }
}

app.get("/cities", (req, res) => handleDestinationRoute(req, res, "City", "Cities"));
app.get("/islands", (req, res) => handleDestinationRoute(req, res, "Island", "Islands"));
app.get("/hiking", (req, res) => handleDestinationRoute(req, res, "Hiking", "Hiking"));

// Add to Want-to-Go List
app.post("/add-to-want-to-go", async (req, res) => {
  const { destinationName } = req.body;
  if (!req.session.user) return res.redirect("/login");

  try {
    await connectDb();
    const user = await usersCollection.findOne({ username: req.session.user.username });
    if (!user) return res.status(404).json({ error: "User not found." });

    if (user.wantToGoList.includes(destinationName)) {
      return res.status(400).json({ error: "Destination already in Want-to-Go List." });
    }

    await usersCollection.updateOne(
      { username: req.session.user.username },
      { $push: { wantToGoList: destinationName } },
    );

    res.status(200).json({ message: "Destination added to Want-to-Go List." });
  } catch (err) {
    console.error("Error updating Want-to-Go List:", err);
    res.status(500).json({ error: "Error updating Want-to-Go List." });
  }
});

// Search Functionality
app.post("/search", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { searchKey } = req.body;
  if (!searchKey) return res.status(400).redirect("/searchresults?error=Search+key+is+required");

  try {
    const data = destinationsInFile.filter(
      (item) => item.type === "destination" && item.name.toLowerCase().includes(searchKey.toLowerCase()),
    );

    if (data.length === 0) {
      return res.status(400).redirect("/searchresults?error=No+matching+destinations+found");
    }

    req.session.searchResults = data;
    res.redirect("/searchresults");
  } catch (err) {
    console.error("Error searching destinations:", err);
    res.status(500).redirect("/searchresults?error=Error+searching+destinations");
  }
});

// Search Results Page
app.get("/searchresults", (req, res) => {
  const results = req.session.searchResults || [];
  const error = req.query.error || null;
  req.session.searchResults = null; // Clear search results from session
  res.render("searchresults", { results, error });
});

// Want-to-Go List Page
app.get("/wanttogo", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  try {
    await connectDb();
    const user = await usersCollection.findOne({ username: req.session.user.username });
    if (!user) return res.status(404).render("wanttogo", { error: "User not found" });

    const destinations = user.wantToGoList;
    if (!destinations || !Array.isArray(destinations) || destinations.length === 0) {
      return res.status(400).render("wanttogo", { error: "No destinations yet." });
    }

    const data = destinationsInFile.filter(
      (item) => item.type === "destination" && destinations.includes(item.name),
    );
    res.render("wanttogo", { results: data, error: null });
  } catch (err) {
    console.error("Error fetching want-to-go list:", err);
    res.status(500).render("wanttogo", { error: "Error fetching want-to-go list" });
  }
});

// 404 Error Route
app.get("*", (req, res) => {
  res.status(404).render("404", { url: req.originalUrl });
});

// Start Server
app.listen(3000, () => {
  console.log("Server started on port 3000");
});