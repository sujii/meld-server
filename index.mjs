import fs from "fs";
import path from "path";

const INJECTED_CODE = fs.readFileSync(
  path.join(__dirname, "injected.html"),
  "utf8",
);

const MeldServer = {
  server: null,
  watcher: null,
  logLevel: 2,
};

// Launch browser
if (openPath !== null)
  if (typeof openPath === "object") {
    openPath.forEach(function (p) {
      open(openURL + p, { app: browser });
    });
  } else {
    open(openURL + openPath, { app: browser });
  }

MeldServer.shutdown = () => {
  const watcher = MeldServer.watcher;
  if (watcher) {
    watcher.close();
  }
  const server = MeldServer.server;
  if (server) {
    server.close();
  }
};

const escape = (html) =>
  String(html)
    .replace(/&(?!\w+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const staticServer = (root) => {
  let isFile = false;
  try {
    isFile = fs.statSync(root).isFile();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  return function (req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const reqpath = isFile ? "" : url.parse(req.url).pathname;
    const hasNoOrigin = !req.headers.origin;
    const injectCandidates = [
      new RegExp("</body>", "i"),
      new RegExp("</svg>"),
      new RegExp("</head>", "i"),
    ];
    const injectTag = null;

    function directory() {
      const pathname = url.parse(req.originalUrl).pathname;
      res.statusCode = 301;
      res.setHeader("Location", pathname + "/");
      res.end("Redirecting to " + escape(pathname) + "/");
    }

    function file(filepath /*, stat*/) {
      let x = path.extname(filepath).toLocaleLowerCase(),
        match,
        possibleExtensions = ["", ".html", ".htm", ".xhtml", ".php", ".svg"];
      if (hasNoOrigin && possibleExtensions.indexOf(x) > -1) {
        // TODO: Sync file read here is not nice, but we need to determine if the html should be injected or not
        const contents = fs.readFileSync(filepath, "utf8");
        for (const i = 0; i < injectCandidates.length; ++i) {
          match = injectCandidates[i].exec(contents);
          if (match) {
            injectTag = match[0];
            break;
          }
        }
        if (injectTag === null && MeldServer.logLevel >= 3) {
          // console.warn(
          //   "Failed to inject refresh script!".yellow,
          //   "Couldn't find any of the tags ",
          //   injectCandidates,
          //   "from",
          //   filepath,
          // );
        }
      }
    }

    function error(err) {
      if (err.status === 404) return next();
      next(err);
    }

    function inject(stream) {
      if (injectTag) {
        // We need to modify the length given to browser
        const len = INJECTED_CODE.length + res.getHeader("Content-Length");
        res.setHeader("Content-Length", len);
        const originalPipe = stream.pipe;
        stream.pipe = function (resp) {
          originalPipe
            .call(
              stream,
              es.replace(new RegExp(injectTag, "i"), INJECTED_CODE + injectTag),
            )
            .pipe(resp);
        };
      }
    }

    send(req, reqpath, { root: root })
      .on("error", error)
      .on("directory", directory)
      .on("file", file)
      .on("stream", inject)
      .pipe(res);
  };

  // ... (End staticServer function body)
};

const entryPoint = (staticHandler, file) => {
  if (!file)
    return (req, res, next) => {
      next();
    };

  return function (req, res, next) {
    req.url = "/" + file;
    staticHandler(req, res, next);
  };
};

MeldServer.start = (options = {}) => {
  // ... (MeldServer.start function body)

  options = options || {};
  const host = options.host || "0.0.0.0";
  // const port = options.port !== undefined ? options.port : 8080; // 0 means random
  const root = options.root || process.cwd();
  const mount = options.mount || [];
  const watchPaths = options.watch || [root];
  MeldServer.logLevel = options.logLevel === undefined ? 2 : options.logLevel;
  const openPath =
    options.open === undefined || options.open === true
      ? ""
      : options.open === null || options.open === false
        ? null
        : options.open;
  if (options.noBrowser) openPath = null; // Backwards compatibility with 0.7.0
  const file = options.file;
  const staticServerHandler = staticServer(root);
  // const wait = options.wait === undefined ? 100 : options.wait;
  const browser = options.browser || null;
  const htpasswd = options.htpasswd || null;
  const cors = options.cors || false;
  const https = options.https || null;
  const proxy = options.proxy || [];
  const middleware = options.middleware || [];
  // const noCssInject = options.noCssInject;
  const httpsModule = options.httpsModule;

  if (httpsModule) {
    try {
      require.resolve(httpsModule);
    } catch (e) {
      // console.error(
      //   ('HTTPS module "' + httpsModule + "\" you've provided was not found.")
      //     .red,
      // );
      // console.error("Did you do", '"npm install ' + httpsModule + '"?');
      return;
    }
  } else {
    httpsModule = "https";
  }

  // Setup a web server
  const app = connect();

  // Add logger. Level 2 logs only errors
  if (MeldServer.logLevel === 2) {
    app.use(
      logger("dev", {
        skip: function (req, res) {
          return res.statusCode < 400;
        },
      }),
    );
    // Level 2 or above logs all requests
  } else if (MeldServer.logLevel > 2) {
    app.use(logger("dev"));
  }
  if (options.spa) {
    middleware.push("spa");
  }
  // Add middleware
  middleware.map(function (mw) {
    if (typeof mw === "string") {
      const ext = path.extname(mw).toLocaleLowerCase();
      if (ext !== ".js") {
        mw = require(path.join(__dirname, "middleware", mw + ".js"));
      } else {
        mw = require(mw);
      }
    }
    app.use(mw);
  });

  // Use http-auth if configured
  if (htpasswd !== null) {
    const auth = require("http-auth");
    const basic = auth.basic({
      realm: "Please authorize",
      file: htpasswd,
    });
    app.use(auth.connect(basic));
  }
  if (cors) {
    app.use(
      require("cors")({
        origin: true, // reflecting request origin
        credentials: true, // allowing requests with credentials
      }),
    );
  }
  mount.forEach(function (mountRule) {
    const mountPath = path.resolve(process.cwd(), mountRule[1]);
    if (!options.watch)
      // Auto add mount paths to wathing but only if exclusive path option is not given
      watchPaths.push(mountPath);
    app.use(mountRule[0], staticServer(mountPath));
    // if (MeldServer.logLevel >= 1)
    // console.log('Mapping %s to "%s"', mountRule[0], mountPath);
  });
  proxy.forEach(function (proxyRule) {
    const proxyOpts = url.parse(proxyRule[1]);
    proxyOpts.via = true;
    proxyOpts.preserveHost = true;
    app.use(proxyRule[0], require("proxy-middleware")(proxyOpts));
    // if (MeldServer.logLevel >= 1)
    //   console.log('Mapping %s to "%s"', proxyRule[0], proxyRule[1]);
  });
  app
    .use(staticServerHandler) // Custom static server
    .use(entryPoint(staticServerHandler, file))
    .use(serveIndex(root, { icons: true }));

  let server, protocol;
  if (https !== null) {
    const httpsConfig = https;
    if (typeof https === "string") {
      httpsConfig = require(path.resolve(process.cwd(), https));
    }
    server = require(httpsModule).createServer(httpsConfig, app);
    protocol = "https";
  } else {
    server = http.createServer(app);
    protocol = "http";
  }

  // Handle server startup errors
  server.addListener("error", function (e) {
    if (e.code === "EADDRINUSE") {
      // const serveURL = protocol + "://" + host + ":" + port;
      // console.log(
      //   "%s is already in use. Trying another port.".yellow,
      //   serveURL,
      // );
      setTimeout(function () {
        server.listen(0, host);
      }, 1000);
    } else {
      // console.error(e.toString().red);
      MeldServer.shutdown();
    }
  });

  // Handle successful server
  server.addListener("listening", function (/*e*/) {
    MeldServer.server = server;

    const address = server.address();
    const serveHost =
      address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
    const openHost = host === "0.0.0.0" ? "127.0.0.1" : host;

    const serveURL = protocol + "://" + serveHost + ":" + address.port;
    const openURL = protocol + "://" + openHost + ":" + address.port;

    const serveURLs = [serveURL];
    if (MeldServer.logLevel > 2 && address.address === "0.0.0.0") {
      const ifaces = os.networkInterfaces();
      serveURLs = Object.keys(ifaces)
        .map(function (iface) {
          return ifaces[iface];
        })
        // flatten address data, use only IPv4
        .reduce(function (data, addresses) {
          addresses
            .filter(function (addr) {
              return addr.family === "IPv4";
            })
            .forEach(function (addr) {
              data.push(addr);
            });
          return data;
        }, [])
        .map(function (addr) {
          return protocol + "://" + addr.address + ":" + address.port;
        });
    }

    // Output
    if (MeldServer.logLevel >= 1) {
      if (serveURL === openURL)
        if (serveURLs.length === 1) {
          console.log('Serving "%s" at %s'.green, root, serveURLs[0]);
        } else {
          console.log(
            'Serving "%s" at\n\t%s'.green,
            root,
            serveURLs.join("\n\t"),
          );
        }
      else
        console.log('Serving "%s" at %s (%s)'.green, root, openURL, serveURL);
    }
  });

  // ... (End MeldServer.start function body)
};

export default MeldServer;
