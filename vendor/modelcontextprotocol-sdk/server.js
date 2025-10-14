export class Server {
  constructor(options = {}) {
    this.options = options;
    this.tools = new Map();
  }

  tool(name, config, handler) {
    this.tools.set(name, { config, handler });
  }

  async connect(transport) {
    if (transport && typeof transport.start === 'function') {
      await transport.start(this);
    }
  }
}
