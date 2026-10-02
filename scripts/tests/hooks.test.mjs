import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, commitCount } from '../../.claude/hooks/before-bash.mjs';
import { commitMessage, subjectProblems } from '../commit-message.mjs';
import { endsWithQuestion, offerToRecord, todoCounts, unrecordedOffer } from '../journals.mjs';

test('before-bash: публикация — отказ, пробный прогон и упоминание в тексте — мимо', () => {
  assert.equal(classify('./gradlew -p mods/stallium modrinth -PtargetMc=26.3').kind, 'forbidden');
  assert.equal(classify('cd x && ../../gradlew modrinthSyncBody').kind, 'forbidden');
  assert.equal(classify('MODRINTH_TOKEN=x node scripts/modrinth.mjs sync stallium').kind, 'forbidden');
  assert.equal(classify('git push && gh release create stallium/1.1.0').kind, 'forbidden');
  assert.equal(classify('./gradlew -p mods/stallium modrinth -PmodrinthDryRun -PtargetMc=26.3'), undefined);
  assert.equal(classify('node scripts/modrinth.mjs sync stallium --dry-run'), undefined);
  assert.equal(classify('node scripts/modrinth.mjs published stallium 1.0.0+26.1'), undefined);
  assert.equal(classify('grep -rn "gh release create" scripts'), undefined);
  assert.equal(classify('./gradlew -p mods/stallium build'), undefined);
  assert.equal(classify('cat > notes.md <<EOF\n./gradlew modrinth\nEOF'), undefined);
});

test('before-bash: коммит и пуш узнаются, коммиты считаются', () => {
  assert.deepEqual(classify('git add -A && git commit -m "x"'), { kind: 'git', commit: true, push: false });
  assert.deepEqual(classify('git commit -m "x" && git push origin main'), { kind: 'git', commit: true, push: true });
  assert.deepEqual(classify('git push'), { kind: 'git', commit: false, push: true });
  assert.equal(classify('echo "git push"'), undefined);
  assert.equal(commitCount('git commit -m a && git commit -m b'), 2);
  assert.equal(commitCount('git add scripts/commit-message.mjs'), 0);
});

test('commit-message: правило коммитов', () => {
  assert.equal(commitMessage('git commit -m "feat(stallium): Добавить X"'), 'feat(stallium): Добавить X');
  assert.deepEqual(subjectProblems('feat(stallium): Добавить таймер'), []);
  assert.equal(subjectProblems('fix: stuff').length, 1);
  assert.deepEqual(subjectProblems('fix(repo): поправить.'), ['суть — с заглавной буквы', 'без точки в конце']);
});

test('journals: TODO по разделам и предложения без записи', () => {
  assert.deepEqual(todoCounts('## Предложено\n\n- [ ] 2026-10-02 · a\n- [ ] 2026-10-02 · b\n## Ждёт\n- [ ] 2026-10-02 · c\n'), {
    Предложено: 2,
    Ждёт: 1,
  });
  assert.equal(unrecordedOffer('Готово. Могу ещё обновить Loom.'), 'Могу ещё обновить Loom.');
  assert.equal(unrecordedOffer('Готово. Записал в docs/TODO.md: обновить Loom.'), undefined);
  assert.equal(endsWithQuestion('Обновить Loom сейчас?'), true);
  assert.equal(offerToRecord('Могу обновить Loom.', { changed: false }), undefined);
});
