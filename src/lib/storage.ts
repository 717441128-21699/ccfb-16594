import type { Student, StudentRecord } from '../types';

const STUDENTS_KEY = 'golf-vision:students:v1';
const RECORDS_KEY = 'golf-vision:records:v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable in privacy mode; the current session still works.
  }
}

export function loadStudents(): Student[] {
  const students = read<Student[]>(STUDENTS_KEY, []);
  if (!students.length) {
    const demo: Student = {
      id: 'student-demo',
      name: '示例学员',
      handedness: 'right',
      createdAt: new Date().toISOString(),
      goal: '把 slice 控制成小 fade',
    };
    write(STUDENTS_KEY, [demo]);
    return [demo];
  }
  return students;
}

export function saveStudents(students: Student[]) {
  write(STUDENTS_KEY, students);
}

export function loadRecords(): StudentRecord[] {
  return read<StudentRecord[]>(RECORDS_KEY, []);
}

export function saveRecords(records: StudentRecord[]) {
  write(RECORDS_KEY, records);
}
