import React, { createContext, useContext } from 'react';

export interface DepartmentSetting {
  name: string;
  color: string;
}

export interface RoleSetting {
  name: string;
  tier: string;
}

export interface TeamSettingsData {
  id: number;
  teamNumber: number;
  teamName: string;
  themeColor: string;
  logoUrl: string | null;
  departments: DepartmentSetting[];
  roles: RoleSetting[];
  teamProgram: string;
  /** Home-base IANA timezone. See utils/timeFormat.ts for how this is used
   *  to show a viewer's own device time alongside it when they differ. */
  timezone: string;
}

export const DEFAULT_TEAM_SETTINGS: TeamSettingsData = {
  id: 1,
  teamNumber: 31130,
  teamName: 'ManeFrame',
  themeColor: '#4169e1',
  logoUrl: null,
  teamProgram: 'FTC',
  timezone: 'America/Los_Angeles',
  departments: [
    { name: 'Mechanical', color: '#f97316' },
    { name: 'Software', color: '#3b82f6' },
    { name: 'Modeling', color: '#8b5cf6' },
    { name: 'Logistics', color: '#22c55e' },
    { name: 'Electrical', color: '#eab308' },
    { name: 'Business', color: '#14b8a6' },
    { name: 'Leadership', color: '#ef4444' },
  ],
  roles: [
    { name: 'Coach', tier: 'leadership' },
    { name: 'Team Captain', tier: 'leadership' },
    { name: 'SCRUM Master', tier: 'leadership' },
    { name: 'Department Head', tier: 'lead' },
    { name: 'Trainer', tier: 'lead' },
    { name: 'Team Member', tier: 'member' },
    { name: 'Class Member', tier: 'member' },
  ],
};

interface TeamSettingsContextValue {
  settings: TeamSettingsData;
  setSettings: (s: TeamSettingsData) => void;
}

export const TeamSettingsContext = createContext<TeamSettingsContextValue>({
  settings: DEFAULT_TEAM_SETTINGS,
  setSettings: () => {},
});

export const useTeamSettings = () => useContext(TeamSettingsContext);
