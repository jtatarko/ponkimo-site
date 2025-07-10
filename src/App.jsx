import { useState } from "react";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <main>
        <h1>Ponkimo is on its way here.</h1>
        <a
          href="https://ponkimo.framer.website/"
          target="_top"
          rel="noopener noreferrer"
        >
          Visit current position
        </a>
      </main>
    </>
  );
}

export default App;
