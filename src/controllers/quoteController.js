function createQuote(req, res) {
  return res.status(200).json({
    success: true,
    message: "Rotta preventivi collegata correttamente",
    receivedData: req.body
  });
}

module.exports = { createQuote };