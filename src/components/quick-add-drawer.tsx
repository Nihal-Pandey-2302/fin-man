import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

// Bottom sheet on every screen size; the amount → category → save flow lands in Phase 1.
export function QuickAddDrawer({ open, onOpenChange }: Props) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <DrawerHeader>
            <DrawerTitle>Quick add</DrawerTitle>
            <DrawerDescription>Cash spends in three taps. Coming in Phase 1.</DrawerDescription>
          </DrawerHeader>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
