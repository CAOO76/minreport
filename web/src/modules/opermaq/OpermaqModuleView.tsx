import React from "react";
import App, { type OpermaqAppProps } from "./App";
import { ThemeProvider } from "./providers/ThemeProvider";
import "./locales/i18n";

export const OpermaqModuleView: React.FC<OpermaqAppProps> = (props) => {
    return (
        <ThemeProvider embedded={true}>
            <App {...props} embedded={true} />
        </ThemeProvider>
    );
};

export default OpermaqModuleView;
