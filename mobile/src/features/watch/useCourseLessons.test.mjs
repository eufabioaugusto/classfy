import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./useCourseLessons.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function catalog(course = 'course-a') {
  const modules = [0, 1, 2].map(index => ({ id: `${course}-module-${index}`, course_id: course, title: `Módulo ${index}`, order_index: index }));
  const lesson = (index, module, order) => ({ id: `${course}-lesson-${index}`, course_id: course, module_id: modules[module].id, title: `Aula ${index}`, order_index: order, video_url: `https://private.example/${course}/${index}.m3u8` });
  const first = lesson(1, 1, 0), second = lesson(2, 1, 1), third = lesson(3, 2, 0);
  return { modules, lessons: [third, second, first], first, second, third };
}
function harness(initial = {}) {
  let owner = 'owner-a', input = { courseId: 'course-a', enabled: true }, cursor = 0, effects = [], dirty = true, disposed = false, current, writes = 0;
  const slots = [], calls = [], renders = [];
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(initialValue) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }; return [slots[index].value, value => { writes++; const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useCallback(callback, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: callback, deps }; return slots[index].value; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) effects.push({ index, callback, deps }); },
  };
  const supabase = { from(table) {
    const query = { table, filters: {}, columns: '', order: null }; let promise;
    const builder = {
      select(columns) { query.columns = columns; return builder; },
      eq(column, value) { query.filters[column] = value; return builder; },
      order(column, options) { query.order = { column, options }; return builder; },
      maybeSingle() { return builder; },
      then(resolve, reject) {
        if (!promise) promise = new Promise((yes, no) => { query.resolve = yes; query.reject = no; calls.push(query); });
        return promise.then(resolve, reject);
      },
    };
    return builder;
  } };
  const dependencies = { react: hooks, '@/lib/supabase': { supabase }, '@/features/auth/authContext': { useAuth: () => ({ user: owner ? { id: owner } : null }) } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const update = values => { if ('owner' in values) owner = values.owner; input = { ...input, ...Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'owner')) }; dirty = true; };
  update(initial);
  const pump = async () => {
    for (let round = 0; round < 30; round++) {
      if (!disposed && dirty) {
        cursor = 0; dirty = false; effects = [];
        current = module.exports.useCourseLessons(input); renders.push(current);
        for (const effect of effects) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { deps: effect.deps, cleanup: effect.callback() }; }
      }
      await new Promise(resolve => setImmediate(resolve)); if (disposed || !dirty) return;
    }
    throw new Error('Course lessons did not settle');
  };
  const query = (table, batch = 0) => { const value = calls.filter(call => call.table === table)[batch]; assert.ok(value, `${table} batch ${batch}`); return value; };
  const resolve = (table, data, batch = 0, error = null) => query(table, batch).resolve({ data, error });
  const complete = (batch = 0, course = 'course-a', enrollment = {}) => {
    const rows = catalog(course); resolve('course_modules', rows.modules, batch); resolve('course_lessons', rows.lessons, batch);
    const enrollmentQuery = calls.filter(call => call.table === 'course_enrollments')[batch];
    enrollmentQuery?.resolve({ data: { id: `${course}-enrollment`, completed_lessons: [rows.first.id], progress_percent: 33, last_lesson_id: rows.third.id, ...enrollment }, error: null });
    return rows;
  };
  return { pump, update, calls, renders, query, resolve, complete, state: () => current, writes: () => writes,
    dispose: () => { if (!disposed) { disposed = true; for (const slot of slots) slot?.cleanup?.(); } },
  };
}

test('catálogo e matrícula iniciam juntos; aula de retomada só é publicada após confirmação correta', async () => {
  const h = harness(), rows = catalog();
  try {
    await h.pump(); assert.deepEqual(h.calls.map(call => call.table), ['course_modules', 'course_lessons', 'course_enrollments']);
    assert.ok(h.calls.every(call => call.filters.course_id === 'course-a')); assert.equal(h.query('course_enrollments').filters.user_id, 'owner-a');
    h.resolve('course_modules', rows.modules); h.resolve('course_lessons', rows.lessons); await h.pump(); assert.equal(h.state().loading, true); assert.equal(h.state().currentLesson, null);
    h.resolve('course_enrollments', { id: 'enrollment', completed_lessons: [rows.first.id], progress_percent: 33, last_lesson_id: rows.third.id }); await h.pump();
    assert.equal(h.state().loading, false); assert.equal(h.state().currentLesson.id, rows.third.id); assert.deepEqual(h.state().completedLessons, [rows.first.id]); assert.equal(h.state().progressPercent, 33);
    assert.deepEqual(h.state().modules[1].lessons.map(lesson => lesson.id), [rows.first.id, rows.second.id]); assert.ok(h.renders.every(state => !state.currentLesson || state.currentLesson.id === rows.third.id));
  } finally { h.dispose(); }
});
test('aula solicitada vence last_lesson_id sem perder progresso e seleção não refaz as consultas', async () => {
  const rows = catalog(), h = harness({ initialLessonId: rows.second.id });
  try {
    await h.pump(); h.complete(); await h.pump(); assert.equal(h.state().currentLesson.id, rows.second.id); assert.equal(h.state().progressPercent, 33);
    await h.state().selectLesson(rows.third); await h.pump(); assert.equal(h.state().currentLesson.id, rows.third.id); assert.equal(h.calls.length, 3); assert.deepEqual(h.state().completedLessons, [rows.first.id]);
  } finally { h.dispose(); }
});
test('retomada inexistente cai na primeira aula ordenada, passando por módulo vazio', async () => {
  const h = harness();
  try { await h.pump(); const rows = h.complete(0, 'course-a', { last_lesson_id: 'deleted-lesson' }); await h.pump(); assert.equal(h.state().currentLesson.id, rows.first.id); assert.equal(h.state().error, null); }
  finally { h.dispose(); }
});
test('curso sem aulas termina carregamento sem inventar uma aula', async () => {
  const h = harness();
  try { await h.pump(); h.resolve('course_modules', []); h.resolve('course_lessons', []); h.resolve('course_enrollments', null); await h.pump(); assert.deepEqual(h.state().modules, []); assert.equal(h.state().currentLesson, null); assert.equal(h.state().loading, false); }
  finally { h.dispose(); }
});
test('sem usuário consulta só catálogo e não reutiliza matrícula de outra conta', async () => {
  const h = harness({ owner: undefined });
  try { await h.pump(); assert.equal(h.calls.length, 2); const rows = h.complete(); await h.pump(); assert.equal(h.state().currentLesson.id, rows.first.id); assert.deepEqual(h.state().completedLessons, []); assert.equal(h.state().progressPercent, 0); }
  finally { h.dispose(); }
});
for (const change of ['owner', 'course', 'initialLesson']) for (const outcome of ['resolve', 'reject']) test(`troca de ${change} descarta retorno ${outcome} antigo sem expor a aula anterior`, async () => {
  const h = harness(), nextCourse = change === 'course' ? 'course-b' : 'course-a', nextRows = catalog(nextCourse);
  try {
    await h.pump(); const staleRefresh = h.state().refresh, staleSelect = h.state().selectLesson;
    h.update(change === 'owner' ? { owner: 'owner-b' } : change === 'course' ? { courseId: nextCourse } : { initialLessonId: nextRows.second.id }); await h.pump();
    assert.equal(h.state().currentLesson, null); assert.deepEqual(h.state().modules, []); assert.equal(h.state().loading, true);
    await staleRefresh(); await staleSelect(catalog().first); await h.pump(); assert.equal(h.calls.length, 6); assert.equal(h.state().currentLesson, null);
    h.complete(1, nextCourse); await h.pump(); const expectedId = change === 'initialLesson' ? nextRows.second.id : nextRows.third.id, writes = h.writes();
    if (outcome === 'reject') h.query('course_lessons').reject(Error('Stale catalog failure'));
    h.complete(); await h.pump();
    assert.equal(h.state().currentLesson.id, expectedId); assert.equal(h.state().error, null); assert.equal(h.writes(), writes);
  } finally { h.dispose(); }
});
test('curso e owner mudam depois do primeiro resultado sem flash de aula/conclusões da conta anterior', async () => {
  const h = harness();
  try {
    await h.pump(); h.complete(); await h.pump(); const previous = h.renders.length;
    h.update({ owner: 'owner-b', courseId: 'course-b' }); await h.pump();
    assert.ok(h.renders.slice(previous).every(state => !state.currentLesson && !state.modules.length && !state.completedLessons.length && state.progressPercent === 0));
    h.complete(1, 'course-b'); await h.pump(); assert.equal(h.state().currentLesson.course_id, 'course-b');
  } finally { h.dispose(); }
});
for (const change of ['disabled', 'unmount']) for (const outcome of ['resolve', 'reject']) test(`retorno ${outcome} tardio após ${change} não atualiza estado nem inicia novas consultas`, async () => {
  const h = harness();
  try {
    await h.pump(); const refresh = h.state().refresh;
    if (change === 'unmount') h.dispose(); else { h.update({ enabled: false }); await h.pump(); assert.equal(h.state().loading, false); assert.equal(h.state().currentLesson, null); }
    const writes = h.writes(); if (outcome === 'reject') h.query('course_modules').reject(Error('Stale catalog failure')); h.complete(); await h.pump(); await refresh(); assert.equal(h.writes(), writes); assert.equal(h.calls.length, 3);
  } finally { h.dispose(); }
});
test('refresh concorrente conserva somente o resultado mais novo e sua posição salva', async () => {
  const h = harness();
  try {
    await h.pump(); h.complete(); await h.pump(); const older = h.state().refresh(); await h.pump(); const newer = h.state().refresh(); await h.pump();
    const rows = h.complete(2, 'course-a', { last_lesson_id: catalog().second.id, completed_lessons: [catalog().first.id, catalog().second.id], progress_percent: 66 }); await newer; await h.pump();
    const writes = h.writes(); h.complete(1); await older; await h.pump(); assert.equal(h.writes(), writes); assert.equal(h.state().currentLesson.id, rows.second.id); assert.equal(h.state().progressPercent, 66);
  } finally { h.dispose(); }
});
test('falha de catálogo encerra carregamento e permite refresh posterior sem erro persistente', async () => {
  const h = harness();
  try {
    await h.pump(); h.query('course_modules').reject(Error('Não foi possível ler as aulas.')); await h.pump(); assert.equal(h.state().loading, false); assert.equal(h.state().error, 'Não foi possível ler as aulas.'); assert.equal(h.state().currentLesson, null);
    const refresh = h.state().refresh(); await h.pump(); h.complete(1); await refresh; await h.pump(); assert.equal(h.state().error, null); assert.equal(h.state().currentLesson.id, catalog().third.id);
  } finally { h.dispose(); }
});
