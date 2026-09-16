process.env.NODE_ENV = "test";
const { server } = await import("../server.mjs");
const listener = server.listeners("request")[0];

export default function handler(request, response) {
  return listener(request, response);
}
