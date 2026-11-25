import { useEffect, useMemo, useState } from 'react';
import type { Calibration, RadarReference, Student, StudentRecord } from './types';
import { ImportPage, type MediaSelection } from './components/ImportPage';
import { CalibrationPage } from './components/CalibrationPage';
import { AnalysisPage } from './components/AnalysisPage';
import { ProfilesPage } from './components/ProfilesPage';
import { defaultCalibration } from './lib/defaultCalibration';
import { loadRecords, loadStudents, saveRecords, saveStudents } from './lib/storage';

type Page = 'import' | 'calibrate' | 'analyze' | 'students';

export default function App() {
  const [page, setPage] = useState<Page>('import');
  const [media, setMedia] = useState<MediaSelection | null>(null);
  const [calibration, setCalibration] = useState<Calibration>(() => defaultCalibration('side'));
  const [students, setStudents] = useState<Student[]>(() => loadStudents());
  const [records, setRecords] = useState<StudentRecord[]>(() => loadRecords());
  const [studentId, setStudentId] = useState('student-demo');

  useEffect(() => saveStudents(students), [students]);
  useEffect(() => saveRecords(records), [records]);

  const student = useMemo(() => students.find((s) => s.id === studentId) ?? students[0], [students, studentId]);

  const handleImport = (selection: MediaSelection, cameraView: Calibration['cameraView']) => {
    setMedia(selection);
    setCalibration(selection.sample ? structuredClone(selection.sample.calibration) : defaultCalibration(cameraView, student?.handedness));
    setPage('calibrate');
  };

  const handleAddStudent = (s: Student) => {
    setStudents((prev) => [...prev, s]);
    setStudentId(s.id);
  };

  const handleSaveRecord = (result: StudentRecord['result'], radar: RadarReference | undefined, notes: string) => {
    if (!media || !student) return;
    const record: StudentRecord = {
      id: `record-${Date.now()}`,
      studentId: student.id,
      date: new Date().toISOString(),
      videoName: media.name,
      sampleId: media.sample?.id,
      result,
      radar,
      notes,
    };
    setRecords((prev) => [record, ...prev]);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('import')}>
          <span className="brand-mark">⛳</span>
          <span>挥杆视觉雷达<small>Blur-based golf launch monitor</small></span>
        </button>
        <nav className="tabs">
          <button className={page === 'import' ? 'active' : ''} onClick={() => setPage('import')}>1 视频导入</button>
          <button className={page === 'calibrate' ? 'active' : ''} onClick={() => media && setPage('calibrate')} disabled={!media}>2 尺度标定</button>
          <button className={page === 'analyze' ? 'active' : ''} onClick={() => media && setPage('analyze')} disabled={!media}>3 挥杆分析</button>
          <button className={page === 'students' ? 'active' : ''} onClick={() => setPage('students')}>4 学员档案</button>
        </nav>
      </header>

      <main className="main">
        {page === 'import' && <ImportPage onContinue={handleImport} />}
        {page === 'calibrate' && media && (
          <CalibrationPage
            media={media}
            calibration={calibration}
            onChange={setCalibration}
            onBack={() => setPage('import')}
            onAnalyze={() => setPage('analyze')}
          />
        )}
        {page === 'analyze' && media && (
          <AnalysisPage
            media={media}
            calibration={calibration}
            student={student}
            onBackCalibration={() => setPage('calibrate')}
            onSaveRecord={handleSaveRecord}
          />
        )}
        {page === 'students' && (
          <ProfilesPage
            students={students}
            records={records}
            selectedStudentId={student?.id ?? studentId}
            onSelectStudent={setStudentId}
            onAddStudent={handleAddStudent}
          />
        )}
        {!media && (page === 'calibrate' || page === 'analyze') && (
          <div className="card empty-state">请先导入视频。<button className="btn primary" onClick={() => setPage('import')}>去导入</button></div>
        )}
      </main>
      <footer className="footer">
        单目手机视频无法替代专业雷达的全部三维测量；本应用提供曝光假设下的速度/角度估计与同步雷达标定工作流。
      </footer>
    </div>
  );
}
