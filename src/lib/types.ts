export type SubItem = {
  id: string;
  name: string;
  score: number | null;
  maxScore: number;
  classAvg?: number | null;
  classMedian?: number | null;
  classMax?: number | null;
  classStdDev?: number | null;
  scaleTargetId?: string | null;
};

export type Component = {
  id: string;
  name: string;
  weight: number;
  maxScore: number;
  score: number | null;
  subItems?: SubItem[];
  bestOf?: number;
  statsMode?: 'global' | 'per-sub';
  scaleTargetId?: string | null;
  classAvg?: number | null;
  classMedian?: number | null;
  classMax?: number | null;
  classStdDev?: number | null;
};

export type Course = {
  id: string;
  name: string;
  fullName: string;
  color: string;
  hideAbsoluteGrade?: boolean;
  hideRelativeGrade?: boolean;
  classSize?: number | null;
  components: Component[];
};

export type SemesterMeta = {
  id: string;
  label: string;
  branch: string;
  semester: string;
  createdAt: number;
  isActive: boolean;
  courseCount: number;
};
