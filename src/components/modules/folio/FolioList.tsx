import React from "react";
import { Folio } from "@/types/folio";
import { Guest } from "@/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FolioListProps {
  folios: Folio[];
  guests: Guest[];
  onSelect: (folio: Folio) => void;
  selectedFolioId?: string;
}

const FolioList: React.FC<FolioListProps> = ({ folios, guests, onSelect, selectedFolioId }) => {
  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {folios.length === 0 ? (
          <p className="text-center text-muted-foreground p-4">No active folios found</p>
        ) : (
          folios.map((folio) => {
            const guest = guests.find(g => g.id === folio.guestId);
            return (
              <Button
                key={folio.id}
                variant={selectedFolioId === folio.id ? "default" : "outline"}
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => onSelect(folio)}
              >
                <div>
                  <div className="font-medium">{guest?.name || "Unknown Guest"}</div>
                  <div className="text-sm text-muted-foreground">Room {folio.roomNumber}</div>
                  <div className="text-sm">Balance: ${Number(folio.balance || 0).toFixed(2)}</div>
                </div>
              </Button>
            );
          })
        )}
      </div>
    </ScrollArea>
  );
};

export default FolioList;