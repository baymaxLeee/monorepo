import { useEffect } from "react";

import UserManualFile from "@/assets/doc/AgentFrame 310 用户手册.pdf";

type ReplaceLocation = (url: string) => void;

export function redirectToUserManual(replace: ReplaceLocation = (url) => window.location.replace(url)) {
  replace(UserManualFile);
}

const Help = () => {
  useEffect(() => {
    redirectToUserManual();
  }, []);

  return null;
};

export default Help;
