const express = require("express");
const router = express.Router();
const User = require("../models/User");

router.get("/user/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).send("User not found");
  res.json(user);
});

router.post("/user", async (req, res) => {
  const user = new User(req.body);
  await user.save();
  res.status(201).send("User created");
});

module.exports = router;