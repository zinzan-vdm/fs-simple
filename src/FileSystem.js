const nfs = require('fs/promises');
const npath = require('path');

class Path {
  constructor(path) {
    this._path = path instanceof Path ? path.path : path;
  }

  static from(path) {
    return path instanceof Path ? path : new Path(path);
  }

  clone() {
    return Path.from(this.path);
  }

  prefix(prefix) {
    prefix = Path.from(prefix);

    this._path = npath.join(prefix.path, this._path);

    return this;
  }

  postfix(postfix) {
    postfix = Path.from(postfix);

    this._path = npath.join(this._path, postfix.path);

    return this;
  }

  append(...paths) {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];

      if (path instanceof Path) paths[i] = path.path;
    }

    this._path = npath.join(this._path, ...paths);

    return this;
  }

  prepend(...paths) {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];

      if (path instanceof Path) paths[i] = path.path;
    }

    this._path = npath.join(...paths, this._path);

    return this;
  }

  pop() {
    this._path = this._path.replace(new RegExp(`[\/\\\\]{0,1}${this.basename}$`), '');

    return this;
  }

  push(path) {
    return this.append(path);
  }

  replace(matcher, replacement) {
    this._path = this._path.replace(matcher, replacement);

    return this;
  }

  inside(path) {
    path = Path.from(path);

    const iAbs = path.absolute;
    const tAbs = this.absolute;

    return tAbs.startsWith(iAbs + '/') || tAbs.startsWith(iAbs + '\\');
  }

  is(path) {
    path = Path.from(path);

    const iAbs = path.absolute;
    const tAbs = this.absolute;

    return tAbs === iAbs;
  }

  bundle() {
    return {
      path: this.path,
      relative: this.relative,
      absolute: this.absolute,
      dirname: this.dirname,
      basename: this.basename,
      extname: this.extname,
    };
  }

  relativeTo(path) {
    path = Path.from(path);

    const iAbs = path.absolute;
    const tAbs = this.absolute;

    return Path.from(tAbs.replace(new RegExp(`${iAbs}[/\\\\]`), ''));
  }

  get absolute() {
    return npath.resolve(this._path);
  }

  get relative() {
    return npath.relative(process.cwd(), this._path);
  }

  get path() {
    return this._path;
  }

  get dirname() {
    return npath.dirname(this._path);
  }

  get basename() {
    return npath.basename(this._path);
  }

  get extname() {
    return npath.extname(this._path);
  }

  toString() {
    return this.path;
  }

  toJSON() {
    return this.path;
  }
}

class FS {}

FS.isAccessible = async function isAccessible(path) {
  path = Path.from(path);

  try {
    await nfs.access(path.absolute);

    return true;
  } catch (e) {
    return false;
  }
};

FS.stat = async function stat(path) {
  path = Path.from(path);
  const abs = path.absolute;

  if (!(await FS.isAccessible(abs))) {
    throw new Error(`'${abs}' does not exist or is not accessible by this user.`);
  }

  const stat = await nfs.stat(abs);

  return stat;
};

FS.ls = async function ls(path) {
  path = Path.from(path);

  const stat = await FS.stat(path);

  if (!stat.isDirectory()) {
    throw new Error(`You can not perform an 'ls' on a non-directory path (${path.absolute}).`);
  }

  const subpaths = await nfs.readdir(path.absolute);

  for (let i = 0; i < subpaths.length; i++) {
    const subpath = Path.from(subpaths[i]);

    subpath.prepend(path.path);

    subpaths[i] = subpath;
  }

  return subpaths;
};

FS.tree = async function tree(path) {
  path = Path.from(path);

  const stat = await FS.stat(path);
  const isDirectory = stat.isDirectory();

  const node = {
    path: path,
    isDirectory: isDirectory,
  };

  await FS.tree._resolveChildren(node);

  return node;
};

FS.tree.flatten = function tree_flatten(node) {
  let paths = [];

  paths.push(node.path.clone());

  if (!node.isDirectory || !node.children || !node.children.length) {
    return paths;
  }

  for (let i = 0; i < node.children.length; i++) {
    const childNode = node.children[i];

    paths = paths.concat(FS.tree.flatten(childNode));
  }

  return paths;
};

FS.tree.files = function tree_files(node) {
  let paths = [];

  if (!node.isDirectory) {
    paths.push(node.path.clone());

    return paths;
  }

  if (!node.children || !node.children.length) {
    return paths;
  }

  for (let i = 0; i < node.children.length; i++) {
    const childNode = node.children[i];

    paths = paths.concat(FS.tree.files(childNode));
  }

  return paths;
};

FS.tree.directories = function tree_directories(node) {
  let paths = [];

  if (!node.isDirectory || !node.children || !node.children.length) {
    return paths;
  }

  paths.push(node.path.clone());

  for (let i = 0; i < node.children.length; i++) {
    const childNode = node.children[i];

    paths = paths.concat(FS.tree.directories(childNode));
  }

  return paths;
};

FS.tree._resolveChildren = async function (node) {
  const path = node.path;
  const isDirectory = node.isDirectory;

  if (!isDirectory) return;

  const children = await FS.ls(path);

  if (!children.length) {
    return;
  }

  const childNodes = [];

  const childrenStatPromises = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    const statPromise = FS.stat(child);
    childrenStatPromises.push(statPromise);
  }

  const childrenStats = await Promise.all(childrenStatPromises);
  const recursePromises = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const stat = childrenStats[i];
    const isChildDirectory = stat.isDirectory();

    const childNode = {
      path: child,
      isDirectory: isChildDirectory,
    };

    if (isDirectory) {
      const recursePromise = FS.tree._resolveChildren(childNode);

      recursePromises.push(recursePromise);
    }

    childNodes.push(childNode);
  }

  await Promise.all(recursePromises);

  node.children = childNodes;
};

FS.read = async function read(path) {
  path = Path.from(path);

  const stat = await FS.stat(path);

  if (!stat.isFile()) {
    throw new Error(`'${path.absolute}' is not a file that can be read.`);
  }

  const buffer = await nfs.readFile(path.absolute);

  return buffer.toString();
};

FS.write = async function write(path, content) {
  path = Path.from(path);
  const dir = Path.from(path.dirname);

  const dirstat = await FS.stat(dir.absolute);

  if (!dirstat.isDirectory()) {
    throw new Error(`'${dir.absolute}' is not a directory to which a file can be written.`);
  }

  await nfs.writeFile(path.absolute, content);
};

FS.append = async function append(path, content) {
  path = Path.from(path);
  const dir = Path.from(path.dirname);

  const dirstat = await FS.stat(dir.absolute);

  if (!dirstat.isDirectory()) {
    throw new Error(`'${dir.absolute}' is not a directory to which a file can be written.`);
  }

  await nfs.appendFile(path.absolute, content);
};

FS.mkdir = async function mkdir(path) {
  path = Path.from(path);

  await nfs.mkdir(path.absolute, { recursive: true });
};

module.exports = { FS, Path };
