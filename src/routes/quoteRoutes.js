const express = require("express");
const router = express.Router();
const { createQuote } = require("../controllers/quoteController");

router.post("/create", createQuote);

module.exports = router;