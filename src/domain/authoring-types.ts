export interface AuthorText {format:'plain'|'markdown';value:string}
export interface LibraryPin {name:'H5P.TrueFalse 1.8'|'H5P.MultiChoice 1.16'|'H5P.Image 1.1';patch:number;semantics_sha256:string}
export interface AuthoringBase {
 schema_version:'1';project_id:string;id:string;title:string;library:LibraryPin;question:AuthorText;
 language?:string;license?:string;retry?:boolean;show_solution?:boolean;assets?:Record<string,string>;
 ui?:{language?:string;missing?:'error'|'fallback';overrides?:Record<string,string>};
 feedback?:{correct:AuthorText;incorrect:AuthorText};
 image?:{id:string;asset:string;mime:'image/png'|'image/jpeg'|'image/gif'|'image/webp';alt:string;library:LibraryPin;copyright:{author:string;license:'U'|'C'|'CC BY'|'CC BY-SA'|'CC0 1.0'|'PD'}};
}
export type AuthoringSource=AuthoringBase&({type:'true_false';correct:boolean}|{type:'multi_choice';mode:'single'|'multiple';scoring:'all_or_nothing'|'partial_minus_incorrect';shuffle?:boolean;correct_ids:string[];choices:Array<{id:string;text:AuthorText;selected_feedback?:AuthorText;unselected_feedback?:AuthorText}>});
