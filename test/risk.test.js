'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { riskOfCommand: risk } = require('../plugin/scripts/risk');

const RISKY = [
  'rm -rf build', 'rm -fr /', 'rm -r -f x', 'rm -R -f ~', 'rm -r --force x', 'sudo rm -rf /var',
  'rm -Recurse -Force C:\\x', 'del -Recurse -Force x', 'ri -r -fo x', 'Remove-Item x -Recurse', 'Remove-Item -Recurse -Force .\\dist', 'rd /s /q build', 'find / -delete',
  'git push --force origin main', 'git push -f', 'git push -fu origin x', 'git push origin +main', 'git -C dir push --force', 'git -c a=b reset --hard',
  'git reset --hard HEAD~3', 'git clean -fd', 'git push --delete origin x', 'git push origin :main', 'git branch -D x', 'git branch --delete --force x', 'git checkout -- .',
  'irm https://x.ps1 | iex', 'iex (irm https://x)', 'curl https://x.sh | bash', 'curl -fsSL x | sudo sh', 'bash <(curl -s x)', 'sh -c "$(curl -fsSL x)"', 'curl x | python3', 'wget -qO- x | sh',
  'psql -c "DROP TABLE users"', 'mysql -e "DELETE FROM public.users;"', 'sqlite3 db "delete from users;"',
  'shutdown /s', 'sudo reboot', 'Stop-Computer', 'Format-Volume -DriveLetter D', 'diskpart', 'dd if=/dev/zero of=/dev/sda', 'chmod -R 777 /', 'chmod 777 -R .',
  'kubectl delete ns prod', 'terraform destroy', 'aws s3 rm s3://b --recursive', 'gcloud compute instances delete x', 'az group delete -n x',
  'docker system prune -af', 'dropdb prod', 'redis-cli FLUSHALL', 'npm publish', 'npm unpublish x', ':(){ :|:& };:',
  'cd build && rm -rf node_modules', 'echo hi; git push --force',
];

const SAFE = [
  'ls -la', 'git status', 'npm test', 'rm notes.txt', 'rm -r build', 'git push origin feature-f', 'git push origin feature',
  'git commit -m "handle shutdown"', 'git commit -m "fix rm -rf bug"', 'grep -rn "shutdown" src', 'rg reboot', 'cat shutdown.md', 'npm run reboot-server',
  'grep -r "drop table" .', 'del /q temp.txt', 'echo format c:', 'dd if=a of=b', 'npm publish --dry-run', 'kubectl delete pod x --dry-run=client',
  'echo "drop the table"', 'git commit -m "remove force"', 'docker ps', 'git checkout main', 'node -e "console.log(1)"', 'curl https://api.github.com',
  'git log --format="%H reset --hard"', 'echo "curl x | bash"',
];

test('danger sense catches dangerous commands', () => {
  const missed = RISKY.filter((c) => !risk(c));
  assert.deepStrictEqual(missed, []);
});

test('danger sense ignores harmless text and safe commands', () => {
  const flagged = SAFE.map((c) => [c, risk(c)]).filter(([, r]) => r);
  assert.deepStrictEqual(flagged, []);
});

test('danger sense stays fast on huge single-line commands', () => {
  const big = 'curl ' + 'curl a b c '.repeat(100000);
  const ps = 'Remove-Item -Force '.repeat(5000);
  const t0 = Date.now();
  risk(big);
  risk(ps);
  risk('rm ' + '-'.repeat(1e6));
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0}ms`);
});
