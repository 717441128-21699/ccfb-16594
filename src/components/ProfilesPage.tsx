import { useMemo, useState } from 'react';
import type { Student, StudentRecord } from '../types';
import { evaluateAccuracy, summarizeBallTests } from '../lib/validation';

interface ProfilesPageProps {
  students: Student[];
  records: StudentRecord[];
  selectedStudentId: string;
  onSelectStudent: (id: string) => void;
  onAddStudent: (student: Student) => void;
}

export function ProfilesPage({ students, records, selectedStudentId, onSelectStudent, onAddStudent }: ProfilesPageProps) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [handedness, setHandedness] = useState<'right' | 'left'>('right');
  const studentRecords = useMemo(
    () => records.filter((r) => r.studentId === selectedStudentId).sort((a, b) => b.date.localeCompare(a.date)),
    [records, selectedStudentId],
  );
  const reports = studentRecords.map((r) => evaluateAccuracy(r.result, {
    clubHeadSpeedMps: r.radar?.clubHeadSpeedMps,
    faceAngleDeg: r.radar?.faceAngleDeg,
    directionDeg: r.radar?.landingDirectionDeg ?? null,
  }));
  const summary = summarizeBallTests(reports);

  return (
    <div className="page profiles-page">
      <div className="page-head">
        <div>
          <h1>学员档案</h1>
          <p>保存每次杆头速度、杆面角、路径、球路和雷达标定，追踪十球测试通过率。</p>
        </div>
      </div>

      <div className="profiles-layout">
        <aside className="card student-list-card">
          <h2>学员</h2>
          <div className="student-list">
            {students.map((s) => (
              <button key={s.id} className={s.id === selectedStudentId ? 'student active' : 'student'} onClick={() => onSelectStudent(s.id)}>
                <span className="avatar">{s.name.slice(0, 1)}</span>
                <span>
                  <b>{s.name}</b>
                  <small>{s.handedness === 'right' ? '右手' : '左手'}{s.goal ? ` · ${s.goal}` : ''}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="add-student">
            <h3>新增学员</h3>
            <input placeholder="姓名" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="目标，例如控制 slice" value={goal} onChange={(e) => setGoal(e.target.value)} />
            <select value={handedness} onChange={(e) => setHandedness(e.target.value as 'right' | 'left')}>
              <option value="right">右手球员</option>
              <option value="left">左手球员</option>
            </select>
            <button
              className="btn primary full"
              onClick={() => {
                if (!name.trim()) return;
                onAddStudent({
                  id: `student-${Date.now()}`,
                  name: name.trim(),
                  goal: goal.trim(),
                  handedness,
                  createdAt: new Date().toISOString(),
                });
                setName('');
                setGoal('');
              }}
            >
              添加
            </button>
          </div>
        </aside>

        <section className="profile-detail">
          <div className="card benchmark-card">
            <h2>对标统计</h2>
            <div className="benchmark-grid">
              <Benchmark value={`${summary.speedWithin5}/${summary.count || 0}`} label="速度 ≤5%" rate={summary.speedPassRate} />
              <Benchmark value={`${summary.faceWithin2}/${summary.count || 0}`} label="杆面 ≤2°" rate={summary.facePassRate} />
              <Benchmark value={`${summary.directionCorrect}/${summary.directionEligible}`} label="方向判对" rate={summary.directionRate} target="≥9/10" />
              <div className="benchmark advice">
                <b>训练建议</b>
                <span>{adviceFor(studentRecords)}</span>
              </div>
            </div>
          </div>

          <div className="records-list">
            {studentRecords.length === 0 && <div className="card empty-state">还没有分析记录。去导入页选择样例或学员视频并保存。</div>}
            {studentRecords.map((record) => {
              const report = evaluateAccuracy(record.result, {
                clubHeadSpeedMps: record.radar?.clubHeadSpeedMps,
                faceAngleDeg: record.radar?.faceAngleDeg,
                directionDeg: record.radar?.landingDirectionDeg ?? null,
              });
              return (
                <article key={record.id} className="card record-card">
                  <header>
                    <div>
                      <h3>{record.videoName}</h3>
                      <time>{new Date(record.date).toLocaleString()}</time>
                    </div>
                    <span className="shot-badge">{record.result.shot.label}</span>
                  </header>
                  <div className="record-metrics">
                    <span><b>{record.result.clubHeadSpeedMps.toFixed(1)}</b> m/s</span>
                    <span>杆面 <b>{record.result.faceAngleDeg.toFixed(1)}°</b></span>
                    <span>路径 <b>{record.result.pathAngleDeg.toFixed(1)}°</b></span>
                    <span>平面 <b>{Math.abs(record.result.swingPlaneAngleDeg).toFixed(1)}°</b></span>
                    {record.radar?.clubHeadSpeedMps && <span className={report.speedPass ? 'pass-text' : 'fail-text'}>雷达速度偏差 {report.speedErrorPct?.toFixed(1)}%</span>}
                    {record.radar?.faceAngleDeg !== undefined && <span className={report.facePass ? 'pass-text' : 'fail-text'}>杆面偏差 {report.faceErrorDeg?.toFixed(2)}°</span>}
                  </div>
                  {record.notes && <p className="record-notes">{record.notes}</p>}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function Benchmark({ value, label, rate, target }: { value: string; label: string; rate: number; target?: string }) {
  return (
    <div className="benchmark">
      <strong>{value}</strong>
      <span>{label}</span>
      <div className="mini-progress"><i style={{ width: `${Math.round(rate * 100)}%` }} /></div>
      {target && <small>{target}</small>}
    </div>
  );
}

function adviceFor(records: StudentRecord[]): string {
  if (!records.length) return '完成十球同步测试后，这里会汇总 slice/hook 倾向。';
  const avgFace = records.reduce((s, r) => s + r.result.faceAngleDeg, 0) / records.length;
  const avgPath = records.reduce((s, r) => s + r.result.pathAngleDeg, 0) / records.length;
  if (avgFace > 2.5 && avgPath < -1) return '杆面持续打开且路径外到内，优先检查 over-the-top 与握杆，练习闭合杆面的半挥杆。';
  if (avgFace < -2 && avgPath > 3) return '路径过度由内向外且杆面关闭，注意下盘旋转和杆头释放时机，避免 hook。';
  if (avgPath < -2) return '路径偏外到内，放球位置略前移，感受右肘贴身和杆头从目标线内侧接近球。';
  if (avgPath > 3) return '路径偏内到外，避免过度向后内侧引杆，练习沿目标线送杆。';
  return '角度总体中性，继续保持并积累十球样本。';
}
