const fs = require('node:fs');

// Windows creates symbolic links only with Developer Mode or admin rights. A directory junction needs neither and
// lstat reports it as a symbolic link, which is what the guarded tests exercise. A file link that cannot be created
// skips the test instead of failing it.
function linkOrSkip(t, target, linkPath, type) {
  const targetIsDir = fs.statSync(target, { throwIfNoEntry: false })?.isDirectory();
  const kind = process.platform === 'win32' && (type === 'dir' || targetIsDir) ? 'junction' : type;
  try {
    fs.symlinkSync(target, linkPath, kind);
    return true;
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip('symbolic links need Developer Mode on Windows');
    return false;
  }
}

module.exports = { linkOrSkip };
