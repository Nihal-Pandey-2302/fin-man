import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsDesktop } from "@/hooks/use-media-query";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
};

/** Bottom sheet on phones (thumb-reachable, swipe to close), centred dialog on laptops. */
export function ResponsiveSheet({ open, onOpenChange, title, description, children }: Props) {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : "sr-only"}>{description ?? title}</DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription className={description ? undefined : "sr-only"}>{description ?? title}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
