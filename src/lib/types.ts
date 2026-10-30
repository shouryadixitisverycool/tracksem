/** Marks for an item worked out from other items instead of entered */
export type ScaleRule = {
  /** Ids of components or sub-items in the same course, or 'course' for every other component */
  from: string[] | 'course';
  /** absolute: the same %; relative: the same percentile, placed on this item's own class curve */
  mode: 'absolute' | 'relative';
  /** How several sources are averaged: by their course weight, or equally */
  combine: 'weight' | 'equal';
};

export type SubItem = {
  id: string;
  name: string;
  score: number | null;
  maxScore: number;
  classAvg?: number | null;
  classMedian?: number | null;
  classMax?: number | null;
  classStdDev?: number | null;
  /** Percentage (0–100) of the class that scored full marks */
  classFullPct?: number | null;
  scale?: ScaleRule | null;
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
  scale?: ScaleRule | null;
  classAvg?: number | null;
  classMedian?: number | null;
  classMax?: number | null;
  classStdDev?: number | null;
  /** Percentage (0–100) of the class that scored full marks */
  classFullPct?: number | null;
};

export type Course = {
  id: string;
  name: string;
  fullName: string;
  color: string;
  hideAbsoluteGrade?: boolean;
  hideRelativeGrade?: boolean;
  classSize?: number | null;
  credits?: number | null;
  /** Final letter grade once officially released; overrides predictions in SGPA/CGPA */
  officialGrade?: string | null;
  /** Catalog template id the course was seeded from (used by reset) */
  templateId?: string | null;
  semesterId?: string | null;
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
