import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type { JSX } from "react";

import { PluginData } from "../domain/task";
import { TaskStore } from "../domain/TaskStore";
import { DailyTasksEditor } from "./DailyTasksEditor";
import type { DailyTemplateActions } from "./dailyTemplateActions";

interface DailyTasksAppProps {
  store: TaskStore;
  actions: DailyTemplateActions;
}

export function DailyTasksApp({
  store,
  actions,
}: DailyTasksAppProps): JSX.Element {
  const snapshot = useTaskSnapshot(store);

  return (
    <DailyTasksEditor
      store={store}
      templates={snapshot.dailyTemplates}
      actions={actions}
    />
  );
}

function useTaskSnapshot(store: TaskStore): PluginData {
  const [revision, setRevision] = useState(0);

  useEffect(
    () => store.subscribe(() => setRevision((current) => current + 1)),
    [store],
  );

  return useMemo(() => store.getSnapshot(), [revision, store]);
}
