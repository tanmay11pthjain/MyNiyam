// Fails clearly if the port is taken, instead of letting Next quietly pick another one.
//   node scripts/check-port.mjs [port]   (defaults to $PORT, then 3000, like next start)
import net from "node:net";

const port = Number(process.argv[2] || process.env.PORT || 3000);
const server = net.createServer();
server.once("error", () => {
  console.error(`Port ${port} is already in use. Is MyNiyam already running? Stop it, or set PORT to another port.`);
  process.exit(1);
});
server.once("listening", () => server.close(() => process.exit(0)));
server.listen(port, "0.0.0.0");
