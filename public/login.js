document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const errorMessage = document.getElementById("errorMessage");
  const passwordInput = document.getElementById("password");

  errorMessage.textContent = "";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        password: passwordInput.value
      })
    });

    const result = await response.json();

    if (!response.ok) {
      errorMessage.textContent = result.error || "Errore di accesso.";
      return;
    }

    window.location.href = "/";
  } catch (error) {
    console.error("Errore login:", error);
    errorMessage.textContent = "Errore di connessione al server.";
  }
});