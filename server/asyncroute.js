function asyncify(router) {
  for (const m of ["get", "post", "put", "delete", "patch"]) {
    const orig = router[m].bind(router);
    router[m] = (path, ...handlers) => orig(path, ...handlers.map((h) => typeof h === "function" && h.length < 4 ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h));
  }
  return router;
}

export { asyncify };
